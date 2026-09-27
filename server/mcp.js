import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { isMediaFile, formatTime } from './transcribe.js';

const READ_CHUNK_CHARS = 30_000;

/** Garante um header (em headers e rawHeaders, que é o que o transporte lê). */
function ensureHeader(req, name, isOk, value) {
  if (isOk(String(req.headers[name] || '').toLowerCase())) return;
  req.headers[name] = value;
  const raw = req.rawHeaders || [];
  for (let i = raw.length - 2; i >= 0; i -= 2) if (raw[i].toLowerCase() === name) raw.splice(i, 2);
  raw.push(name, value);
}

/**
 * Servidor MCP da Base de Conhecimento (transporte Streamable HTTP, sem estado).
 * Permite que agentes externos — como a Active AI no GPTMaker ou no n8n — pesquisem e leiam os documentos.
 */
export function createMcpHandler({ repo, publicUrl = '' }) {
  const kindOf = (i) => (i.kind === 'article' ? 'texto' : isMediaFile(i.file_name, i.mime_type) ? 'vídeo/áudio (transcrição)' : 'arquivo');
  const link = (id) => `${publicUrl.replace(/\/$/, '')}/#/item/${id}`;
  // Registro no terminal de cada uso das ferramentas, para acompanhar o que o agente consulta.
  const log = (msg) => console.log(`[mcp ${new Date().toLocaleTimeString('pt-BR')}] ${msg}`);
  const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] });

  function buildServer() {
    const server = new McpServer({ name: 'base-conhecimento-active', version: '1.0.0' });

    server.registerTool(
      'buscar_documentos',
      {
        title: 'Buscar documentos na Base de Conhecimento',
        description:
          'Pesquisa em texto completo nos documentos da Base de Conhecimento do Suporte da Active Corp (títulos, tags, descrições, conteúdo de textos e arquivos e transcrições de vídeos de treinamentos e reuniões). ' +
          'Retorna os documentos mais relevantes com id, título, categoria, trecho encontrado e link. Use palavras-chave; tente sinônimos se não encontrar.',
        inputSchema: {
          consulta: z.string().min(1).describe('Palavras-chave da busca'),
          limite: z.number().int().min(1).max(25).optional().describe('Máximo de resultados (padrão 8)'),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ consulta, limite }) => {
        const results = repo.search(consulta, { limit: limite || 8 });
        log(`buscar_documentos "${consulta}" → ${results.length} resultado(s)${results.length ? `: ${results.slice(0, 3).map((r) => `#${r.id} ${r.title}`).join(' | ')}` : ''}`);
        if (!results.length) return text(`Nenhum documento encontrado para "${consulta}".`);
        return text(
          results.map((r) => ({
            id: r.id,
            titulo: r.title,
            tipo: kindOf(r),
            categoria: r.category_name || 'Sem categoria',
            tags: r.tags,
            resumo: r.summary || undefined,
            trecho: r.snippet?.replace(/\[\[|\]\]/g, ''),
            link: link(r.id),
          })),
        );
      },
    );

    server.registerTool(
      'ler_documento',
      {
        title: 'Ler documento',
        description:
          `Lê o conteúdo completo de um documento pelo id. Textos longos vêm em partes de ${READ_CHUNK_CHARS} caracteres; ` +
          'para vídeos e áudios (treinamentos, reuniões), o conteúdo é a transcrição com marcações de tempo [hh:mm:ss] — cite o minuto ao responder; ' +
          'se houver continuação, a resposta informa o próximo valor de "inicio".',
        inputSchema: {
          id: z.number().int().describe('Id do documento'),
          inicio: z.number().int().min(0).optional().describe('Posição inicial (padrão 0)'),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ id, inicio = 0 }) => {
        const item = repo.getItem(id, { full: true });
        log(item ? `ler_documento #${id} "${item.title}" (a partir do caractere ${inicio})` : `ler_documento #${id} → não encontrado`);
        if (!item) return { ...text(`Documento ${id} não encontrado.`), isError: true };
        const body = (item.kind === 'article' ? item.content : item.text) || '';
        const chunk = body.slice(inicio, inicio + READ_CHUNK_CHARS);
        const next = inicio + chunk.length;
        return text({
          id: item.id,
          titulo: item.title,
          tipo: kindOf(item),
          categoria: item.category_name || 'Sem categoria',
          tags: item.tags,
          resumo: item.summary || undefined,
          arquivo: item.file_name || undefined,
          ...(item.duration ? { duracao: formatTime(item.duration) } : {}),
          ...(item.media_status && !['concluida', 'manual'].includes(item.media_status)
            ? { observacao: `Transcrição ainda não disponível (situação: ${item.media_status}).` }
            : {}),
          link: link(item.id),
          total_caracteres: body.length,
          conteudo: chunk || '(documento sem texto legível)',
          ...(next < body.length ? { continua: true, proximo_inicio: next } : {}),
        });
      },
    );

    server.registerTool(
      'listar_documentos',
      {
        title: 'Listar documentos',
        description: 'Lista os documentos mais recentes da base, opcionalmente de uma categoria.',
        inputSchema: {
          categoria_id: z.number().int().optional().describe('Id da categoria'),
          limite: z.number().int().min(1).max(100).optional().describe('Quantidade (padrão 30)'),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ categoria_id, limite }) => {
        const { items, total } = repo.listItems({ categoryId: categoria_id, limit: limite || 30 });
        log(`listar_documentos${categoria_id ? ` categoria ${categoria_id}` : ''} → ${items.length} de ${total}`);
        return text({
          total,
          documentos: items.map((i) => ({ id: i.id, titulo: i.title, categoria: i.category_name || 'Sem categoria', atualizado_em: i.updated_at, link: link(i.id) })),
        });
      },
    );

    server.registerTool(
      'listar_categorias',
      {
        title: 'Listar categorias',
        description: 'Lista as categorias da base com id, descrição e quantidade de documentos.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () => {
        log('listar_categorias');
        return text(repo.listCategories().map((c) => ({ id: c.id, nome: c.name, descricao: c.description, documentos: c.item_count })));
      },
    );

    return server;
  }

  // Modo sem estado: um servidor e um transporte por requisição.
  async function handleMcp(req, res) {
    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST.' }, id: null });
      return;
    }
    // Alguns clientes (inclusive durante a conversa no GPTMaker) não enviam o Accept exigido pelo
    // protocolo ("application/json, text/event-stream") nem o Content-Type. Completa antes de processar.
    ensureHeader(req, 'accept', (v) => v.includes('application/json') && v.includes('text/event-stream'), 'application/json, text/event-stream');
    ensureHeader(req, 'content-type', (v) => v.includes('application/json'), 'application/json');
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] Erro:', err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno' }, id: null });
    }
  }

  // Transporte SSE (versão anterior do protocolo), para clientes MCP que ainda não usam Streamable HTTP:
  // GET /mcp/sse abre o canal; o cliente envia as mensagens por POST em /mcp/messages?sessionId=…
  const sessions = new Map();

  async function handleSse(req, res) {
    const token = req.query.token ? `?token=${encodeURIComponent(req.query.token)}` : '';
    const transport = new SSEServerTransport(`/mcp/messages${token}`, res);
    const server = buildServer();
    sessions.set(transport.sessionId, transport);
    res.on('close', () => {
      sessions.delete(transport.sessionId);
      server.close();
    });
    await server.connect(transport);
  }

  async function handleSseMessage(req, res) {
    const transport = sessions.get(String(req.query.sessionId || ''));
    if (!transport) {
      res.status(404).json({ error: 'Sessão MCP não encontrada. Conecte-se novamente em /mcp/sse.' });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  }

  handleMcp.sse = handleSse;
  handleMcp.sseMessage = handleSseMessage;
  return handleMcp;
}
