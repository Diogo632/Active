import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

let dataDir;
let server;
let base;
const AUTH = `Basic ${Buffer.from('suporte:senha-de-teste-longa').toString('base64')}`;

before(async () => {
  process.env.BASIC_AUTH_USER = 'suporte';
  process.env.BASIC_AUTH_PASSWORD = 'senha-de-teste-longa';
  process.env.INTEGRATION_TOKEN = 'token-de-teste-com-mais-de-trinta-e-dois-caracteres';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-seg-'));
  const created = createApp({ dataDir, ai: { configured: false, chat: async () => {} } });
  await new Promise((r) => (server = created.app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  delete process.env.BASIC_AUTH_USER;
  delete process.env.BASIC_AUTH_PASSWORD;
});

test('sem senha não acessa; com senha acessa; a página tem cabeçalhos de segurança', async () => {
  assert.equal((await fetch(`${base}/api/items`)).status, 401);
  const page = await fetch(`${base}/`, { headers: { Authorization: AUTH } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const csp = page.headers.get('content-security-policy');
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /object-src 'none'/);
  // A página não tem scripts embutidos (a política só permite arquivos da plataforma).
  assert.doesNotMatch(await page.text(), /<script>(?!<\/script>)/);
});

test('ações vindas de outro site (CSRF) são recusadas, mesmo com a senha', async () => {
  const create = (site) =>
    fetch(`${base}/api/articles`, {
      method: 'POST',
      headers: { Authorization: AUTH, 'Content-Type': 'application/json', ...(site ? { 'Sec-Fetch-Site': site } : {}) },
      body: JSON.stringify({ title: 'Teste CSRF' }),
    });
  assert.equal((await create('cross-site')).status, 403);
  assert.equal((await create('same-site')).status, 403);
  assert.equal((await create('same-origin')).status, 201);
  assert.equal((await create(null)).status, 201, 'clientes fora do navegador continuam funcionando');
  // Leitura não é afetada.
  assert.equal((await fetch(`${base}/api/items`, { headers: { Authorization: AUTH, 'Sec-Fetch-Site': 'cross-site' } })).status, 200);
});

test('muitas tentativas com token errado são bloqueadas por um tempo', async () => {
  const tryToken = (token) => fetch(`${base}/api/integracao/buscar?q=x`, { headers: { Authorization: `Bearer ${token}` } });
  for (let i = 0; i < 10; i++) assert.equal((await tryToken('errado')).status, 401);
  const blocked = await tryToken('errado');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  // Bloqueado inclusive para o token certo vindo do mesmo endereço, até a janela passar.
  assert.equal((await tryToken(process.env.INTEGRATION_TOKEN)).status, 429);
});
