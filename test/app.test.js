import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { createActiveIA, sanitizeHistory } from '../server/ai.js';
import { toFtsQuery } from '../server/db.js';
import { startFakeAnthropic, toolUseTurn, textTurn } from './fake-anthropic.js';

let dataDir;
let server;
let base;
let repo;

before(async () => {
  process.env.INTEGRATION_TOKEN = 'tok-teste';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-test-'));
  const created = createApp({ dataDir, ai: { configured: false, model: 'test', chat: async ({ emit }) => emit({ type: 'text', text: 'ok' }) } });
  repo = created.repo;
  await new Promise((resolve) => {
    server = created.app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const json = async (method, url, body) => {
  const res = await fetch(base + url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: res.status === 204 ? null : await res.json() };
};

test('toFtsQuery neutraliza a sintaxe do FTS5', () => {
  assert.equal(toFtsQuery('erro "105" OR (papel)'), '"erro"* "105"* "or"* "papel"*');
  assert.equal(toFtsQuery('   '), null);
  assert.equal(toFtsQuery('a b', 'OR'), '"a"* OR "b"*');
});

test('categorias: criar, duplicar e renomear', async () => {
  const created = await json('POST', '/api/categories', { name: 'Procedimentos', description: 'Passo a passo' });
  assert.equal(created.status, 201);
  const dup = await json('POST', '/api/categories', { name: 'Procedimentos' });
  assert.equal(dup.status, 409);
  const renamed = await json('PUT', `/api/categories/${created.body.id}`, { name: 'Procedimentos internos' });
  assert.equal(renamed.body.name, 'Procedimentos internos');
});

test('textos: criar, pesquisar sem acento, editar e excluir', async () => {
  const { body: cats } = await json('GET', '/api/categories');
  const created = await json('POST', '/api/articles', {
    title: 'Configuração da impressora térmica',
    content: '## Passos\n1. Instale o driver\n2. Configure a porta COM3',
    tags: 'impressora, fiscal, impressora',
    category_id: cats[0].id,
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.tags, ['impressora', 'fiscal']);

  const search = await json('GET', '/api/items?q=configuracao%20impressora');
  assert.equal(search.body.items[0].id, created.body.id);

  const edited = await json('PUT', `/api/items/${created.body.id}`, { content: 'Nova versão com a palavra xilofone' });
  assert.equal(edited.status, 200);
  assert.equal((await json('GET', '/api/items?q=xilofone')).body.items.length, 1);
  assert.equal((await json('GET', '/api/items?q=driver')).body.items.length, 0);

  assert.equal((await json('DELETE', `/api/items/${created.body.id}`)).status, 204);
  assert.equal((await json('GET', `/api/items/${created.body.id}`)).status, 404);
  assert.equal((await json('GET', '/api/items?q=xilofone')).body.items.length, 0);
});

test('arquivos: upload de qualquer tipo, extração, download e exclusão', async () => {
  const fd = new FormData();
  fd.append('files', new Blob(['Erro 105: papel ausente na impressora.'], { type: 'text/plain' }), 'Solução erro.txt');
  fd.append('files', new Blob([new Uint8Array([0, 1, 2, 3])], { type: 'application/octet-stream' }), 'firmware.bin');
  fd.append('tags', 'erros');
  const res = await fetch(`${base}/api/files`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  const [txt, bin] = await res.json();
  assert.equal(txt.file_name, 'Solução erro.txt');
  assert.equal(txt.extract_status, 'ok');
  assert.equal(bin.extract_status, 'unsupported');

  const found = await json('GET', '/api/items?q=papel%20ausente');
  assert.equal(found.body.items[0].id, txt.id);
  assert.match(found.body.items[0].snippet, /\[\[papel\]\]/);

  const download = await fetch(`${base}/api/items/${bin.id}/file`);
  assert.equal(download.headers.get('content-type'), 'application/octet-stream');
  assert.equal(download.headers.get('x-content-type-options'), 'nosniff');

  assert.equal((await json('DELETE', `/api/items/${bin.id}`)).status, 204);
});

test('categoria inválida é rejeitada', async () => {
  const res = await json('POST', '/api/articles', { title: 'x', category_id: 9999 });
  assert.equal(res.status, 400);
});

test('sanitizeHistory mantém alternância e começa pelo usuário', () => {
  const out = sanitizeHistory([
    { role: 'assistant', content: 'oi' },
    { role: 'user', content: 'a' },
    { role: 'user', content: 'b' },
    { role: 'system', content: 'ignorar' },
    { role: 'assistant', content: '  ' },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'a\n\nb' }]);
});

test('Active AI pesquisa na base com ferramentas e cita as fontes', async () => {
  const article = repo.createItem({ kind: 'article', title: 'Troca de bobina', content: 'Para o erro 105 troque a bobina.', tags: 'bobina' });
  const fake = await startFakeAnthropic((body, n) => {
    if (n === 1) return toolUseTurn(body.model, 'buscar_documentos', { consulta: 'erro 105' });
    if (n === 2) return toolUseTurn(body.model, 'ler_documento', { id: article.id });
    return textTurn(body.model, `Veja [Troca de bobina](#/item/${article.id}).`);
  });
  const previousBase = process.env.ANTHROPIC_BASE_URL;
  process.env.ANTHROPIC_BASE_URL = fake.url;
  try {
    const ai = createActiveIA({ repo, uploadsDir: dataDir, model: 'claude-opus-5', apiKey: 'test-key' });
    const events = [];
    await ai.chat({ history: [{ role: 'user', content: 'Como resolvo o erro 105?' }], emit: (e) => events.push(e) });

    assert.equal(fake.requests.length, 3);
    const first = fake.requests[0].body;
    assert.equal(first.model, 'claude-opus-5');
    assert.equal(first.fallbacks, 'default');
    assert.match(fake.requests[0].headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
    assert.deepEqual(first.tools.map((t) => t.name), ['buscar_documentos', 'ler_documento', 'listar_documentos', 'listar_categorias']);

    // O resultado da busca volta para o modelo como tool_result.
    const toolResult = fake.requests[1].body.messages.at(-1).content[0];
    assert.equal(toolResult.type, 'tool_result');
    assert.match(toolResult.content, /Troca de bobina/);
    const readResult = JSON.parse(fake.requests[2].body.messages.at(-1).content[0].content);
    assert.equal(readResult.conteudo, 'Para o erro 105 troque a bobina.');

    const text = events.filter((e) => e.type === 'text').map((e) => e.text).join('');
    assert.match(text, /#\/item\/\d+/);
    assert.ok(events.some((e) => e.type === 'status' && /Pesquisando/.test(e.label)));
    const sources = events.find((e) => e.type === 'sources');
    assert.equal(sources.items[0].id, article.id);
    assert.equal(sources.items[0].read, true);
    assert.ok(!events.some((e) => e.type === 'error'));
  } finally {
    if (previousBase === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = previousBase;
    fake.close();
  }
});

test('Active AI sem chave informa que não está configurada', async () => {
  const saved = { key: process.env.ANTHROPIC_API_KEY, token: process.env.ANTHROPIC_AUTH_TOKEN };
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  try {
    const ai = createActiveIA({ repo, uploadsDir: dataDir, model: 'claude-opus-5' });
    const events = [];
    await ai.chat({ history: [{ role: 'user', content: 'oi' }], emit: (e) => events.push(e) });
    assert.equal(ai.configured, false);
    assert.equal(events[0].type, 'error');
  } finally {
    if (saved.key !== undefined) process.env.ANTHROPIC_API_KEY = saved.key;
    if (saved.token !== undefined) process.env.ANTHROPIC_AUTH_TOKEN = saved.token;
  }
});

test('API de integração exige token e devolve o conteúdo completo', async () => {
  const doc = repo.createItem({ kind: 'article', title: 'Integração teste', content: 'conteúdo integral zebra' });
  assert.equal((await fetch(`${base}/api/integracao/buscar?q=zebra`)).status, 401);
  const found = await (await fetch(`${base}/api/integracao/buscar?q=zebra`, { headers: { Authorization: 'Bearer tok-teste' } })).json();
  assert.equal(found[0].id, doc.id);
  const full = await (await fetch(`${base}/api/integracao/documentos/${doc.id}`, { headers: { Authorization: 'Bearer tok-teste' } })).json();
  assert.equal(full.conteudo, 'conteúdo integral zebra');
});

test('servidor MCP: lista ferramentas, busca e lê documentos (com token)', async () => {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const doc = repo.createItem({ kind: 'article', title: 'Cadastro de ADEME', content: 'Para o ADEME refletir no custo, recalcule a tabela do transportador.' });

  assert.equal((await fetch(`${base}/mcp`, { method: 'POST' })).status, 401);

  const client = new Client({ name: 'teste', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: 'Bearer tok-teste' } } }));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), ['buscar_documentos', 'ler_documento', 'listar_categorias', 'listar_documentos']);

  const found = JSON.parse((await client.callTool({ name: 'buscar_documentos', arguments: { consulta: 'ADEME custo' } })).content[0].text);
  assert.equal(found[0].id, doc.id);
  assert.match(found[0].link, new RegExp(`#/item/${doc.id}$`));

  const read = JSON.parse((await client.callTool({ name: 'ler_documento', arguments: { id: doc.id } })).content[0].text);
  assert.match(read.conteudo, /recalcule a tabela/);
  await client.close();
});
