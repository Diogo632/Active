import 'dotenv/config';
import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, createRepository } from './db.js';
import { extractText } from './extract.js';
import { createActiveIA } from './ai.js';
import { createN8nActiveIA } from './n8n.js';
import { createMcpHandler } from './mcp.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, '..');

export function createApp({
  dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data'),
  maxUploadMb = Number(process.env.MAX_UPLOAD_MB || 100),
  model = process.env.ACTIVE_IA_MODEL || 'claude-opus-5',
  ai: aiOverride,
} = {}) {
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const db = openDatabase(dataDir);
  const repo = createRepository(db);
  const ai = aiOverride || createAssistant({ repo, uploadsDir, model });

  const app = express();
  app.disable('x-powered-by');

  // ---------- Integração (n8n / GPTMaker) ----------
  // Endpoints somente leitura, protegidos por token, para fluxos externos consultarem a base.
  const integrationToken = process.env.INTEGRATION_TOKEN;
  // Aceita o token no header "Authorization: Bearer <token>" ou em ?token= (para clientes que não enviam headers).
  const requireIntegrationToken = (req, res, next) => {
    const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || String(req.query.token || '');
    const given = Buffer.from(raw);
    const expected = Buffer.from(integrationToken || '');
    if (integrationToken && given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
    res.status(401).json({ error: 'Token de integração inválido.' });
  };
  const integration = express.Router();
  integration.use(requireIntegrationToken);
  integration.get('/buscar', (req, res) => {
    const q = String(req.query.q || '').trim();
    const limit = Math.min(Number(req.query.limite) || 8, 25);
    const items = q ? repo.search(q, { limit }) : repo.listItems({ limit }).items;
    res.json(items.map((i) => ({ id: i.id, titulo: i.title, categoria: i.category_name, tags: i.tags, resumo: i.summary, trecho: i.snippet, link: `#/item/${i.id}` })));
  });
  integration.get('/documentos/:id', (req, res) => {
    const item = repo.getItem(parseId(req.params.id), { full: true });
    if (!item) return res.status(404).json({ error: 'Documento não encontrado.' });
    res.json({
      id: item.id, titulo: item.title, tipo: item.kind, categoria: item.category_name, tags: item.tags,
      resumo: item.summary, arquivo: item.file_name, conteudo: item.kind === 'article' ? item.content : item.text,
    });
  });
  app.use('/api/integracao', integration);

  // Servidor MCP: o agente (GPTMaker, n8n ou outro cliente MCP) pesquisa e lê a base por aqui.
  const mcp = createMcpHandler({ repo, publicUrl: process.env.PUBLIC_URL || '' });
  app.all('/mcp', requireIntegrationToken, express.json({ limit: '1mb' }), mcp);
  // Transporte SSE, para clientes MCP mais antigos.
  app.get('/mcp/sse', requireIntegrationToken, mcp.sse);
  app.post('/mcp/messages', requireIntegrationToken, express.json({ limit: '1mb' }), mcp.sseMessage);

  // ---------- Autenticação opcional (HTTP Basic) ----------
  const authUser = process.env.BASIC_AUTH_USER;
  const authPass = process.env.BASIC_AUTH_PASSWORD;
  if (authUser && authPass) {
    const expected = Buffer.from(`${authUser}:${authPass}`);
    app.use((req, res, next) => {
      const header = req.headers.authorization || '';
      const given = Buffer.from(header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString() : '');
      if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return next();
      res.set('WWW-Authenticate', 'Basic realm="Base de Conhecimento Active", charset="UTF-8"');
      res.status(401).send('Autenticação necessária');
    });
  }

  app.use(express.json({ limit: '5mb' }));

  // ---------- Arquivos estáticos ----------
  // Sem cache para HTML/JS/CSS: depois de um "git pull", o navegador sempre recebe a versão nova.
  app.use(
    express.static(path.join(rootDir, 'public'), {
      setHeaders: (res, file) => {
        if (/\.(html|js|css)$/.test(file)) res.set('Cache-Control', 'no-store');
      },
    }),
  );
  app.use('/vendor/marked', express.static(path.join(rootDir, 'node_modules/marked/lib')));
  app.use('/vendor/dompurify', express.static(path.join(rootDir, 'node_modules/dompurify/dist')));

  // ---------- Upload ----------
  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase().replace(/[^.\w]/g, '');
        cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
      },
    }),
    limits: { fileSize: maxUploadMb * 1024 * 1024, files: 50 },
  });

  // O multer lê o nome do arquivo como latin1; converte para UTF-8 para manter acentos.
  const originalName = (file) => Buffer.from(file.originalname, 'latin1').toString('utf8');

  const parseId = (value) => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
  };

  const parseCategory = (value) => {
    if (value === undefined) return undefined;
    if (value === null || value === '' || value === 'none') return null;
    const id = parseId(value);
    if (id === null || !repo.getCategory(id)) throw httpError(400, 'Categoria inválida.');
    return id;
  };

  const removeStored = (storedName) => {
    if (!storedName) return;
    fs.promises.unlink(path.join(uploadsDir, storedName)).catch(() => {});
  };

  // ---------- Categorias ----------
  app.get('/api/categories', (req, res) => res.json(repo.listCategories()));

  app.post('/api/categories', (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) throw httpError(400, 'Informe o nome da categoria.');
    try {
      res.status(201).json(repo.createCategory({ name, description: String(req.body.description || ''), icon: req.body.icon }));
    } catch (err) {
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) throw httpError(409, 'Já existe uma categoria com esse nome.');
      throw err;
    }
  });

  app.put('/api/categories/:id', (req, res) => {
    const id = parseId(req.params.id);
    try {
      const category = id && repo.updateCategory(id, req.body);
      if (!category) throw httpError(404, 'Categoria não encontrada.');
      res.json(category);
    } catch (err) {
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) throw httpError(409, 'Já existe uma categoria com esse nome.');
      throw err;
    }
  });

  app.delete('/api/categories/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (!id || !repo.deleteCategory(id)) throw httpError(404, 'Categoria não encontrada.');
    res.status(204).end();
  });

  // ---------- Itens ----------
  app.get('/api/stats', (req, res) => res.json({ ...repo.stats(), ai: { configured: ai.configured, provider: ai.provider, model: ai.model } }));

  app.get('/api/tags', (req, res) => res.json(repo.allTags()));

  app.get('/api/items', (req, res) => {
    const q = String(req.query.q || '').trim();
    const categoryId = req.query.category === 'none' ? 'none' : parseId(req.query.category) || undefined;
    const kind = ['article', 'file'].includes(req.query.kind) ? req.query.kind : undefined;
    const tag = String(req.query.tag || '').trim().toLowerCase();
    const limit = Math.min(parseId(req.query.limit) || 50, 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const sort = req.query.sort === 'views' ? 'views' : undefined;

    if (q) {
      const items = repo.search(q, { categoryId, kind, limit });
      return res.json({ items, total: items.length, query: q });
    }
    if (tag) {
      const { items } = repo.listItems({ categoryId, kind, limit: 10000 });
      const tagged = items.filter((i) => i.tags.some((t) => t.toLowerCase() === tag));
      return res.json({ items: tagged.slice(offset, offset + limit), total: tagged.length });
    }
    res.json(repo.listItems({ categoryId, kind, limit, offset, sort }));
  });

  app.get('/api/items/:id', (req, res) => {
    const item = repo.getItem(parseId(req.params.id), { full: true });
    if (!item) throw httpError(404, 'Documento não encontrado.');
    if (req.query.view !== undefined) repo.registerView(item.id);
    const { stored_name, ...rest } = item;
    // O texto extraído de arquivos pode ser grande; a interface mostra só uma prévia.
    rest.text_preview = rest.text.slice(0, 20000);
    rest.text_length = rest.text.length;
    delete rest.text;
    res.json(rest);
  });

  app.post('/api/articles', (req, res) => {
    const title = String(req.body.title || '').trim();
    if (!title) throw httpError(400, 'Informe o título do texto.');
    const item = repo.createItem({
      kind: 'article',
      title,
      summary: String(req.body.summary || ''),
      content: String(req.body.content || ''),
      tags: req.body.tags,
      category_id: parseCategory(req.body.category_id),
      author: String(req.body.author || ''),
    });
    res.status(201).json(item);
  });

  app.post('/api/files', upload.array('files'), async (req, res) => {
    const files = req.files || [];
    if (!files.length) throw httpError(400, 'Selecione ao menos um arquivo.');
    let categoryId;
    try {
      categoryId = parseCategory(req.body.category_id);
    } catch (err) {
      files.forEach((f) => removeStored(f.filename));
      throw err;
    }
    const created = [];
    for (const file of files) {
      const name = originalName(file);
      const { text, status } = await extractText(file.path, name);
      const title = files.length === 1 && req.body.title?.trim() ? req.body.title.trim() : path.parse(name).name;
      created.push(
        repo.createItem({
          kind: 'file',
          title,
          summary: String(req.body.summary || ''),
          tags: req.body.tags,
          category_id: categoryId,
          author: String(req.body.author || ''),
          file_name: name,
          stored_name: file.filename,
          mime_type: file.mimetype,
          size: file.size,
          text,
          extract_status: status,
        }),
      );
    }
    res.status(201).json(created);
  });

  app.put('/api/items/:id', (req, res) => {
    const id = parseId(req.params.id);
    const item = id && repo.updateItem(id, { ...req.body, category_id: parseCategory(req.body.category_id) });
    if (!item) throw httpError(404, 'Documento não encontrado.');
    res.json(item);
  });

  // Substitui o arquivo de um documento (nova versão), mantendo título, categoria e tags.
  app.put('/api/items/:id/file', upload.single('file'), async (req, res) => {
    const id = parseId(req.params.id);
    const current = id && repo.getItem(id, { full: true });
    if (!req.file) throw httpError(400, 'Selecione um arquivo.');
    if (!current || current.kind !== 'file') {
      removeStored(req.file.filename);
      throw httpError(404, 'Documento não encontrado.');
    }
    const name = originalName(req.file);
    const { text, status } = await extractText(req.file.path, name);
    const item = repo.replaceFile(id, {
      file_name: name,
      stored_name: req.file.filename,
      mime_type: req.file.mimetype,
      size: req.file.size,
      text,
      extract_status: status,
    });
    removeStored(current.stored_name);
    res.json(item);
  });

  app.delete('/api/items/:id', (req, res) => {
    const item = repo.deleteItem(parseId(req.params.id));
    if (!item) throw httpError(404, 'Documento não encontrado.');
    removeStored(item.stored_name);
    res.status(204).end();
  });

  // Tipos que o navegador pode exibir com segurança dentro da plataforma.
  const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp)|application\/pdf|video\/(mp4|webm|ogg)|audio\/.+|text\/plain)$/;

  app.get('/api/items/:id/file', (req, res) => {
    const item = repo.getItem(parseId(req.params.id), { full: true });
    if (!item || item.kind !== 'file') throw httpError(404, 'Arquivo não encontrado.');
    const inline = req.query.download === undefined && INLINE_TYPES.test(item.mime_type || '');
    // Tipos fora da lista (HTML, SVG etc.) sempre são baixados, nunca renderizados no domínio da plataforma.
    res.set('X-Content-Type-Options', 'nosniff');
    res.attachment(item.file_name);
    if (inline) res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(item.file_name)}`);
    res.type(inline ? item.mime_type : 'application/octet-stream');
    res.sendFile(path.join(uploadsDir, item.stored_name), (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'Arquivo não encontrado no disco.' });
    });
  });

  // ---------- Active AI (streaming via Server-Sent Events) ----------
  app.post('/api/ai/chat', async (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const controller = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });

    const emit = (event) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    await ai.chat({
      history: req.body.messages,
      contextItemId: parseId(req.body.context_item_id),
      sessionId: String(req.body.session_id || '').slice(0, 100),
      mode: req.body.mode === 'livre' ? 'livre' : 'base',
      emit,
      signal: controller.signal,
    });
    emit({ type: 'done' });
    res.end();
  });

  // ---------- Erros ----------
  app.use('/api', (req, res) => res.status(404).json({ error: 'Rota não encontrada.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
      const message =
        err.code === 'LIMIT_FILE_SIZE' ? `Arquivo maior que o limite de ${maxUploadMb} MB.` : `Falha no envio: ${err.message}`;
      return res.status(400).json({ error: message });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'Erro interno do servidor.' : err.message });
  });

  return { app, db, repo, ai };
}

/**
 * Escolhe o motor da Active AI: webhook do n8n (ex.: agente do GPTMaker) quando N8N_WEBHOOK_URL
 * está definido; caso contrário, a API da Anthropic.
 */
function createAssistant({ repo, uploadsDir, model }) {
  const fallback = process.env.N8N_WEBHOOK_URL || !process.env.ANTHROPIC_API_KEY ? 'n8n' : 'anthropic';
  const provider = (process.env.ACTIVE_IA_PROVIDER || fallback).toLowerCase();
  if (provider === 'n8n') {
    return createN8nActiveIA({
      repo,
      webhookUrl: process.env.N8N_WEBHOOK_URL,
      token: process.env.N8N_WEBHOOK_TOKEN,
      options: {
        ...(process.env.N8N_TIMEOUT_SECONDS ? { timeoutMs: Number(process.env.N8N_TIMEOUT_SECONDS) * 1000 } : {}),
        ...(process.env.N8N_MAX_PROMPT_CHARS ? { maxPromptChars: Number(process.env.N8N_MAX_PROMPT_CHARS) } : {}),
        ...(process.env.N8N_INCLUDE_CONTEXT ? { includeContext: !/^(false|0|nao|não|no)$/i.test(process.env.N8N_INCLUDE_CONTEXT) } : {}),
      },
    });
  }
  return { ...createActiveIA({ repo, uploadsDir, model }), provider: 'anthropic' };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 3000);
  const createdInfo = createApp();
  const { app } = createdInfo;
  app.listen(port, (err) => {
    // No Express 5, falhas ao abrir a porta chegam aqui (ex.: outra cópia da plataforma já está rodando).
    if (err) {
      console.error(
        err.code === 'EADDRINUSE'
          ? `Erro: a porta ${port} já está em uso — a plataforma provavelmente já está rodando em outro terminal.\n` +
              `Pare a outra cópia (Ctrl+C naquele terminal ou "pkill -f server/index.js") ou use outra porta: PORT=3001 npm start`
          : `Erro ao iniciar o servidor: ${err.message}`,
      );
      process.exit(1);
    }
    console.log(`Base de Conhecimento Active rodando em http://localhost:${port}`);
    const { ai } = createdInfo;
    if (ai.provider === 'n8n') console.log(`Active AI: webhook do n8n (${process.env.N8N_WEBHOOK_URL})`);
    else if (ai.configured) console.log('Active AI: API da Anthropic');
    if (!ai.configured) console.log('Aviso: Active AI não configurada — defina N8N_WEBHOOK_URL no arquivo .env.');
  });
}
