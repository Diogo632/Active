import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createApp } from '../server/index.js';
import { chunkText } from '../server/semantic.js';

// ---------- Provedor de login (OpenID Connect) simulado, no lugar da Microsoft/Google ----------
let idp;
let idpUrl;
let nextLogin = { email: 'ana@activecorp.com.br', name: 'Ana Souza' };
const codes = new Map();

async function startIdp() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
  idp = http.createServer(async (req, res) => {
    const url = new URL(req.url, idpUrl);
    if (url.pathname === '/.well-known/openid-configuration') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          issuer: idpUrl,
          authorization_endpoint: `${idpUrl}/authorize`,
          token_endpoint: `${idpUrl}/token`,
          jwks_uri: `${idpUrl}/jwks`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
        }),
      );
    }
    if (url.pathname === '/jwks') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    if (url.pathname === '/authorize') {
      const code = Math.random().toString(36).slice(2);
      codes.set(code, { nonce: url.searchParams.get('nonce'), ...nextLogin });
      const back = new URL(url.searchParams.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: back.href });
      return res.end();
    }
    if (url.pathname === '/token') {
      let body = '';
      for await (const c of req) body += c;
      const login = codes.get(new URLSearchParams(body).get('code'));
      const idToken = await new SignJWT({ email: login.email, name: login.name, nonce: login.nonce, email_verified: true })
        .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
        .setIssuer(idpUrl)
        .setAudience('plataforma')
        .setSubject(login.email)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey);
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ access_token: 'at', token_type: 'Bearer', expires_in: 300, id_token: idToken }));
    }
    res.writeHead(404).end();
  });
  await new Promise((r) => idp.listen(0, '127.0.0.1', r));
  idpUrl = `http://127.0.0.1:${idp.address().port}`;
}

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
  await startIdp();
  process.env.AUTH_ALLOWED_DOMAINS = 'activecorp.com.br';
  process.env.AUTH_DEFAULT_ROLE = 'leitor';
  process.env.INTEGRATION_TOKEN = 'token-de-teste-com-mais-de-trinta-e-dois-caracteres';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-conta-'));
  app = createApp({
    dataDir,
    ai: { configured: false, chat: async () => {} },
    embedder: fakeEmbedder,
    authProviders: [{ id: 'oidc', label: 'conta da empresa', issuer: idpUrl, clientId: 'plataforma', clientSecret: 'segredo' }],
  });
  await new Promise((r) => (server = app.app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  idp?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.AUTH_ALLOWED_DOMAINS;
  delete process.env.AUTH_DEFAULT_ROLE;
});

const cookieOf = (res, name) => (res.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).find((c) => c.startsWith(`${name}=`));

/** Faz o login completo (plataforma → provedor → retorno) e devolve o cookie da sessão. */
async function login(as) {
  nextLogin = as;
  const start = await fetch(`${base}/auth/oidc?volta=${encodeURIComponent('/#/docs')}`, { redirect: 'manual' });
  assert.equal(start.status, 302);
  const stateCookie = cookieOf(start, 'kb_login');
  const atIdp = await fetch(start.headers.get('location'), { redirect: 'manual' });
  const callback = await fetch(atIdp.headers.get('location'), { redirect: 'manual', headers: { Cookie: stateCookie } });
  assert.equal(callback.status, 302);
  return { location: callback.headers.get('location'), session: cookieOf(callback, 'kb_sessao') };
}

const api = (cookie, method, url, body) =>
  fetch(base + url, {
    method,
    headers: { Cookie: cookie || '', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });

let admin;
let reader;

test('login individual: sem sessão vai para a página de login; o primeiro a entrar é admin', async () => {
  assert.equal((await fetch(`${base}/api/items`)).status, 401);
  const page = await fetch(`${base}/`, { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.match(page.headers.get('location'), /^\/entrar\?volta=/);
  assert.match(await (await fetch(`${base}/entrar`)).text(), /Entrar com conta da empresa/);

  const first = await login({ email: 'ana@activecorp.com.br', name: 'Ana Souza' });
  assert.equal(first.location, '/#/docs', 'volta para onde a pessoa estava');
  admin = first.session;
  const me = await (await api(admin, 'GET', '/api/me')).json();
  assert.equal(me.user.email, 'ana@activecorp.com.br');
  assert.equal(me.user.role, 'admin');
});

test('conta de fora do domínio da empresa é recusada', async () => {
  const outside = await login({ email: 'alguem@gmail.com', name: 'Fora' });
  assert.equal(outside.location, '/entrar?erro=dominio');
  const page = await (await fetch(`${base}/entrar?erro=dominio`)).text();
  assert.match(page, /Esta conta não é da empresa/);
  const forged = await (await fetch(`${base}/entrar?erro=${encodeURIComponent('Ligue para 0800 e informe sua senha')}`)).text();
  assert.doesNotMatch(forged, /0800/);
  assert.equal(outside.session, undefined);
});

test('perfis: leitor só consulta; admin promove a editor; autor e quem editou ficam registrados', async () => {
  reader = (await login({ email: 'bruno@activecorp.com.br', name: 'Bruno Lima' })).session;
  assert.equal((await (await api(reader, 'GET', '/api/me')).json()).user.role, 'leitor');
  assert.equal((await api(reader, 'POST', '/api/articles', { title: 'Tentativa' })).status, 403);
  assert.equal((await api(reader, 'GET', '/api/items')).status, 200);
  const doc = await (await api(admin, 'POST', '/api/articles', { title: 'Emissão de NF-e', content: 'Erro na emissão de NF-e: verifique o certificado digital.', author: 'Ignorado' })).json();
  assert.equal(doc.author, 'Ana Souza', 'o autor vem do login, não do formulário');
  assert.equal((await api(reader, 'POST', '/api/feedback', { target: 'documento', item_id: doc.id, helpful: true })).status, 201);

  // Só admin vê e muda perfis; ninguém tira o próprio admin.
  assert.equal((await api(reader, 'GET', '/api/usuarios')).status, 403);
  const people = await (await api(admin, 'GET', '/api/usuarios')).json();
  const bruno = people.find((p) => p.email === 'bruno@activecorp.com.br');
  const anaId = people.find((p) => p.email === 'ana@activecorp.com.br').id;
  assert.equal((await api(admin, 'PUT', `/api/usuarios/${anaId}`, { role: 'leitor' })).status, 400);
  assert.equal((await (await api(admin, 'PUT', `/api/usuarios/${bruno.id}`, { role: 'editor' })).json()).role, 'editor');

  await api(reader, 'PUT', `/api/items/${doc.id}`, { content: 'Erro na emissão de NF-e: renove o certificado A1.' });
  const versions = await (await api(admin, 'GET', `/api/items/${doc.id}/versions`)).json();
  assert.equal(versions[0].author, 'Ana Souza', 'a versão anterior é de quem a salvou');
  const updated = await (await api(admin, 'GET', `/api/items/${doc.id}`)).json();
  assert.equal(updated.updated_by, 'Bruno Lima');
  assert.equal(updated.author, 'Ana Souza');

  // Pessoa desativada perde a sessão na hora.
  await api(admin, 'PUT', `/api/usuarios/${bruno.id}`, { active: false });
  assert.equal((await api(reader, 'GET', '/api/items')).status, 401);
});

test('sair encerra a sessão; MCP e integração continuam pelo token', async () => {
  const s = (await login({ email: 'carla@activecorp.com.br', name: 'Carla' })).session;
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
