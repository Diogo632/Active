import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { chunkText } from '../server/semantic.js';
import { hashPassword, verifyPassword, passwordProblem, temporaryPassword } from '../server/auth.js';

// ---------- Busca por significado simulada: vetores por "conceito" ----------
const CONCEPTS = [
  ['nota', 'nf', 'nfe', 'emissao', 'emitir', 'tirar', 'fiscal'],
  ['impressora', 'imprimir', 'bobina', 'papel'],
  ['senha', 'login', 'acesso', 'usuario'],
];
const norm = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const fakeEmbedder = async (texts) =>
  texts.map((t) => {
    const words = norm(t).match(/[a-z0-9]+/g) || [];
    const v = CONCEPTS.map((c) => words.filter((w) => c.includes(w)).length);
    v.push(0.05); // componente comum, para nenhum vetor ficar zerado
    const len = Math.hypot(...v);
    return Float32Array.from(v.map((x) => x / len));
  });
fakeEmbedder.model = 'conceitos-de-teste';

let dataDir;
let server;
let base;
let app;

before(async () => {
  process.env.INTEGRATION_TOKEN = 'token-de-teste-com-mais-de-trinta-e-dois-caracteres';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-conta-'));
  app = createApp({ dataDir, login: true, ai: { configured: false, chat: async () => {} }, embedder: fakeEmbedder });
  await new Promise((r) => (server = app.app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const cookieOf = (res, name = 'kb_sessao') => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`));
const post = (url, fields, headers = {}) =>
  fetch(base + url, { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: new URLSearchParams(fields) });

/** Entra com e-mail e senha; devolve o redirecionamento e o cookie da sessão. */
async function login(email, senha, volta = '/') {
  const res = await post('/entrar', { email, senha, volta });
  return { status: res.status, location: res.headers.get('location'), session: cookieOf(res), html: res.status === 303 ? '' : await res.text() };
}

const api = (cookie, method, url, body) =>
  fetch(base + url, {
    method,
    headers: { Cookie: cookie || '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

let admin;
let reader;
let readerId;

test('senhas: scrypt com sal, senha provisória e regras mínimas', () => {
  const h = hashPassword('uma senha comprida');
  assert.match(h, /^scrypt\$/);
  assert.notEqual(h, hashPassword('uma senha comprida'), 'cada hash tem o seu sal');
  assert.ok(verifyPassword('uma senha comprida', h));
  assert.ok(!verifyPassword('outra senha comprida', h));
  assert.ok(!verifyPassword('x', 'lixo'));
  assert.match(temporaryPassword(), /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.match(passwordProblem('curta'), /pelo menos/);
  assert.match(passwordProblem('1234567890'), /óbvia/);
  assert.match(passwordProblem('ana.souza-2026', { email: 'ana.souza@activecorp.com.br' }), /e-mail/);
  assert.equal(passwordProblem('cavalo bateria grampo'), '');
});

test('primeiro acesso: sem nenhuma conta, quem abre cria o administrador (uma vez só)', async () => {
  assert.equal((await fetch(`${base}/api/items`)).status, 401);
  const page = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/entrar\?volta=/);
  assert.match(await (await fetch(`${base}/entrar`)).text(), /Primeiro acesso/);

  const fields = { nome: 'Ana Souza', email: 'Ana@ActiveCorp.com.br', senha: 'cavalo bateria grampo', confirmacao: 'cavalo bateria grampo' };
  assert.equal((await post('/primeiro-acesso', { ...fields, confirmacao: 'outra coisa qualquer' })).status, 400);
  const created = await post('/primeiro-acesso', fields);
  assert.equal(created.status, 303);
  admin = cookieOf(created);
  const me = await (await api(admin, 'GET', '/api/me')).json();
  assert.deepEqual([me.user.email, me.user.role], ['ana@activecorp.com.br', 'admin']);

  // Depois disso, ninguém mais cria administrador por ali.
  const again = await post('/primeiro-acesso', { ...fields, email: 'intruso@x.com' });
  assert.equal(again.headers.get('location'), '/entrar');
  assert.equal(app.auth.users.count(), 1);
  assert.match(await (await fetch(`${base}/entrar`)).text(), /name="senha"/);
});

test('login: senha errada é recusada sem dizer se o e-mail existe; pedido de outro site é bloqueado', async () => {
  const wrong = await login('ana@activecorp.com.br', 'senha errada demais');
  assert.equal(wrong.status, 401);
  assert.match(wrong.html, /E-mail ou senha incorretos/);
  const unknown = await login('ninguem@activecorp.com.br', 'senha errada demais');
  assert.match(unknown.html, /E-mail ou senha incorretos/);
  const cross = await post('/entrar', { email: 'ana@activecorp.com.br', senha: 'cavalo bateria grampo' }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(cross.status, 403);
  const ok = await login('ANA@activecorp.com.br', 'cavalo bateria grampo', '/#/docs');
  assert.equal(ok.location, '/#/docs', 'volta para onde a pessoa estava');
  assert.ok(ok.session);
  // Volta só para endereços da própria plataforma.
  assert.equal((await login('ana@activecorp.com.br', 'cavalo bateria grampo', '//site-malicioso.com')).location, '/');
});

test('admin cria a conta; a pessoa entra com a senha provisória e precisa criar a dela', async () => {
  const res = await api(admin, 'POST', '/api/usuarios', { name: 'Bruno Lima', email: 'bruno@activecorp.com.br', role: 'leitor' });
  assert.equal(res.status, 201);
  const { user, password } = await res.json();
  readerId = user.id;
  assert.equal(user.must_change_password, 1);
  assert.equal((await api(admin, 'POST', '/api/usuarios', { name: 'Outro', email: 'bruno@activecorp.com.br' })).status, 409);
  assert.ok(!JSON.stringify(await (await api(admin, 'GET', '/api/usuarios')).json()).includes('password_hash'), 'a lista nunca traz a senha');

  const first = await login('bruno@activecorp.com.br', password);
  assert.match(first.location, /^\/trocar-senha/);
  reader = first.session;
  const blocked = await api(reader, 'GET', '/api/items');
  assert.equal(blocked.status, 401);
  assert.equal((await blocked.json()).login, '/trocar-senha');
  assert.match(await (await api(reader, 'GET', '/trocar-senha')).text(), /Crie a sua senha/);

  const change = (fields) => fetch(`${base}/trocar-senha`, { method: 'POST', redirect: 'manual', headers: { Cookie: reader, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(fields) });
  assert.equal((await change({ senha: 'curta', confirmacao: 'curta' })).status, 400);
  assert.equal((await change({ senha: 'girassol amarelo 7', confirmacao: 'girassol amarelo 7' })).status, 303);
  assert.equal((await api(reader, 'GET', '/api/items')).status, 200, 'a sessão continua depois de criar a senha');
  assert.equal((await login('bruno@activecorp.com.br', password)).status, 401, 'a provisória não vale mais');

  // Trocar de novo exige a senha atual.
  assert.equal((await change({ atual: 'errada errada', senha: 'outra senha boa 8', confirmacao: 'outra senha boa 8' })).status, 400);
});

test('perfis: leitor só consulta; admin promove a editor; autor e quem editou ficam registrados', async () => {
  assert.equal((await (await api(reader, 'GET', '/api/me')).json()).user.role, 'leitor');
  assert.equal((await api(reader, 'POST', '/api/articles', { title: 'Tentativa' })).status, 403);
  assert.equal((await api(reader, 'POST', '/api/glossario', { term: 'X' })).status, 403);
  const doc = await (await api(admin, 'POST', '/api/articles', { title: 'Emissão de NF-e', content: 'Erro na emissão de NF-e: verifique o certificado digital.', author: 'Ignorado' })).json();
  assert.equal(doc.author, 'Ana Souza', 'o autor vem do login, não do formulário');
  assert.equal((await api(reader, 'POST', '/api/feedback', { target: 'documento', item_id: doc.id, helpful: true })).status, 201);

  // Só admin vê e muda pessoas; ninguém tira o próprio admin nem se exclui.
  assert.equal((await api(reader, 'GET', '/api/usuarios')).status, 403);
  assert.equal((await api(reader, 'POST', '/api/usuarios', { name: 'X', email: 'x@x.com' })).status, 403);
  const anaId = (await (await api(admin, 'GET', '/api/me')).json()).user.id;
  assert.equal((await api(admin, 'PUT', `/api/usuarios/${anaId}`, { role: 'leitor' })).status, 400);
  assert.equal((await api(admin, 'DELETE', `/api/usuarios/${anaId}`)).status, 400);
  assert.equal((await (await api(admin, 'PUT', `/api/usuarios/${readerId}`, { role: 'editor' })).json()).role, 'editor');

  await api(reader, 'PUT', `/api/items/${doc.id}`, { content: 'Erro na emissão de NF-e: renove o certificado A1.' });
  const versions = await (await api(admin, 'GET', `/api/items/${doc.id}/versions`)).json();
  assert.equal(versions[0].author, 'Ana Souza', 'a versão anterior é de quem a salvou');
  const updated = await (await api(admin, 'GET', `/api/items/${doc.id}`)).json();
  assert.equal(updated.updated_by, 'Bruno Lima');
  assert.equal(updated.author, 'Ana Souza');
});

test('bloquear, gerar senha provisória e excluir encerram as sessões na hora', async () => {
  await api(admin, 'PUT', `/api/usuarios/${readerId}`, { active: false });
  assert.equal((await api(reader, 'GET', '/api/items')).status, 401);
  const refused = await login('bruno@activecorp.com.br', 'girassol amarelo 7');
  assert.equal(refused.status, 401);
  assert.match(refused.html, /bloqueado/);
  await api(admin, 'PUT', `/api/usuarios/${readerId}`, { active: true });

  reader = (await login('bruno@activecorp.com.br', 'girassol amarelo 7')).session;
  const { password } = await (await api(admin, 'POST', `/api/usuarios/${readerId}/senha`)).json();
  assert.equal((await api(reader, 'GET', '/api/items')).status, 401, 'a senha nova derruba a sessão antiga');
  assert.match((await login('bruno@activecorp.com.br', password)).location, /^\/trocar-senha/);

  assert.equal((await api(admin, 'DELETE', `/api/usuarios/${readerId}`)).status, 204);
  assert.equal((await login('bruno@activecorp.com.br', password)).status, 401);
});

test('sair encerra a sessão; MCP e integração continuam pelo token', async () => {
  const s = (await login('ana@activecorp.com.br', 'cavalo bateria grampo')).session;
  assert.equal((await api(s, 'GET', '/api/me')).status, 200);
  await api(s, 'POST', '/auth/sair');
  assert.equal((await api(s, 'GET', '/api/items')).status, 401);
  const viaToken = await fetch(`${base}/api/integracao/buscar?q=NF-e`, { headers: { Authorization: `Bearer ${process.env.INTEGRATION_TOKEN}` } });
  assert.equal(viaToken.status, 200);
});

test('glossário amplia a busca: "CT-e" encontra "conhecimento de transporte"', async () => {
  const created = await api(admin, 'POST', '/api/glossario', {
    term: 'CT-e',
    synonyms: 'conhecimento de transporte, CTe',
    description: 'Conhecimento de Transporte Eletrônico, documento fiscal do frete.',
  });
  assert.equal(created.status, 201);
  const doc = await (await api(admin, 'POST', '/api/articles', { title: 'Cancelar conhecimento de transporte', content: 'Use a tela 306 dentro do prazo.' })).json();
  const found = await (await api(admin, 'GET', '/api/items?q=cancelar%20ct-e')).json();
  assert.equal(found.items[0].id, doc.id);
  assert.equal(app.glossary.describe('como cancelar um CT-e?'), '- CT-e (conhecimento de transporte, CTe): Conhecimento de Transporte Eletrônico, documento fiscal do frete.');

  // O agente consulta o glossário pelo MCP.
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'teste', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${process.env.INTEGRATION_TOKEN}` } } }));
  const terms = JSON.parse((await client.callTool({ name: 'consultar_glossario', arguments: { termo: 'cte' } })).content[0].text);
  assert.equal(terms[0].termo, 'CT-e');
  const search = JSON.parse((await client.callTool({ name: 'buscar_documentos', arguments: { consulta: 'cancelar CT-e' } })).content[0].text);
  assert.ok(search.glossario[0].startsWith('- CT-e'));
  assert.equal(search.documentos[0].id, doc.id);
  await client.close();
});

test('busca por significado: encontra o documento sem nenhuma palavra em comum', async () => {
  await (await api(admin, 'POST', '/api/articles', { title: 'Troca de bobina', content: 'Quando faltar papel, troque a bobina.' })).json();
  const until = Date.now() + 5000;
  while (!app.semantic.idle() && Date.now() < until) await new Promise((r) => setTimeout(r, 30));
  assert.ok(app.semantic.status().indexed >= 2);

  // "tirar nota" não aparece em nenhum documento; pelo significado, o de NF-e é o certo.
  const res = await (await api(admin, 'GET', `/api/items?q=${encodeURIComponent('cliente não consegue tirar nota')}`)).json();
  assert.equal(res.items[0].title, 'Emissão de NF-e');
  assert.equal(res.items[0].by_meaning, true);
  assert.match(res.items[0].snippet, /certificado/);

  // Documento excluído sai do índice.
  await api(admin, 'DELETE', `/api/items/${res.items[0].id}`);
  await new Promise((r) => setTimeout(r, 50));
  const after = await (await api(admin, 'GET', `/api/items?q=${encodeURIComponent('cliente não consegue tirar nota')}`)).json();
  assert.ok(!after.items.some((i) => i.title === 'Emissão de NF-e'));
});

test('divide textos longos em trechos com sobreposição', () => {
  const text = Array.from({ length: 60 }, (_, i) => `Frase número ${i} do procedimento.`).join(' ');
  const chunks = chunkText(text, { size: 300, overlap: 60 });
  assert.ok(chunks.length > 5);
  assert.ok(chunks.every((c) => c.length <= 300));
  // Sobreposição: o fim de um trecho se repete no começo do seguinte.
  assert.ok(chunks[1].includes(chunks[0].slice(-30).trim()));
  assert.deepEqual(chunkText(''), []);
});
