import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, createRepository } from '../server/db.js';
import { createN8nActiveIA, extractReply, keywords, bestExcerpts } from '../server/n8n.js';

let dataDir;
let repo;
let webhook;
let received;
let replyWith;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-n8n-'));
  repo = createRepository(openDatabase(dataDir));
  const cat = repo.createCategory({ name: 'Erros conhecidos' });
  repo.createItem({
    kind: 'file', title: 'Manual impressora fiscal', category_id: cat.id, file_name: 'manual.pdf',
    text: 'Erro 105: papel ausente. Troque a bobina e reinicie a impressora.', tags: 'impressora',
  });
  repo.createItem({ kind: 'article', title: 'Redefinir senha do ERP', content: 'Acesse Admin > Usuários.' });

  webhook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received = { headers: req.headers, body: JSON.parse(body) };
      const { status = 200, payload } = replyWith;
      res.writeHead(status, { 'Content-Type': typeof payload === 'string' ? 'text/plain' : 'application/json' });
      res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
    });
  });
  await new Promise((r) => webhook.listen(0, '127.0.0.1', r));
});

after(() => {
  webhook.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const url = () => `http://127.0.0.1:${webhook.address().port}/webhook/base`;

async function ask(question, extra = {}) {
  const ai = createN8nActiveIA({ repo, webhookUrl: url(), token: 'segredo' });
  const events = [];
  await ai.chat({ history: [{ role: 'user', content: question }], sessionId: 'sessao-1', emit: (e) => events.push(e), ...extra });
  return events;
}

test('keywords remove palavras comuns', () => {
  assert.deepEqual(keywords('Como eu resolvo o erro 105 da impressora?'), ['resolvo', 'erro', '105', 'impressora']);
});

test('bestExcerpts prioriza os trechos com as palavras-chave', () => {
  const text = `${'x'.repeat(3000)} bobina ${'y'.repeat(3000)}`;
  const out = bestExcerpts(text, ['bobina'], 1500, 1500);
  assert.match(out, /bobina/);
  assert.ok(out.length < 1700);
});

test('extractReply entende formatos comuns do n8n/GPTMaker', () => {
  assert.equal(extractReply({ message: 'oi' }), 'oi');
  assert.equal(extractReply([{ output: 'a' }]), 'a');
  assert.equal(extractReply({ data: { resposta: 'b' } }), 'b');
  assert.equal(extractReply('texto puro'), 'texto puro');
  assert.equal(extractReply({ nada: 1 }), '');
});

test('envia pergunta, sessão e documentos relevantes ao webhook', async () => {
  replyWith = { payload: { message: 'Troque a bobina. Veja [Manual impressora fiscal](#/item/1).' } };
  const events = await ask('Como resolvo o erro 105 da impressora?');

  assert.equal(received.headers.authorization, 'Bearer segredo');
  assert.equal(received.body.sessionId, 'sessao-1');
  assert.equal(received.body.pergunta, 'Como resolvo o erro 105 da impressora?');
  assert.equal(received.body.documentos[0].titulo, 'Manual impressora fiscal');
  assert.match(received.body.documentos[0].conteudo, /papel ausente/);
  assert.match(received.body.prompt, /#\/item\/1/);
  assert.match(received.body.prompt, /Erros conhecidos \(1\)/);
  // Compatível com o Chat Trigger do n8n e com webhooks próprios.
  assert.equal(received.body.action, 'sendMessage');
  assert.equal(received.body.contextId, 'sessao-1');
  assert.equal(received.body.chatInput, received.body.prompt);
  assert.equal(received.body.message, received.body.prompt);

  assert.equal(events.filter((e) => e.type === 'text').map((e) => e.text).join(''), 'Troque a bobina. Veja [Manual impressora fiscal](#/item/1).');
  assert.equal(events.find((e) => e.type === 'sources').items[0].id, 1);
});

test('inclui o documento aberto na tela mesmo sem palavras em comum', async () => {
  replyWith = { payload: { output: 'Resumo.' } };
  await ask('Resuma isto', { contextItemId: 2 });
  assert.equal(received.body.documento_aberto.id, 2);
  assert.equal(received.body.documentos[0].id, 2);
});

test('mostra erro amigável quando o n8n falha', async () => {
  replyWith = { status: 500, payload: { error: 'boom' } };
  const events = await ask('erro 105');
  assert.match(events.find((e) => e.type === 'error').message, /erro 500/);
});

test('sem URL do webhook informa que não está configurado', async () => {
  const ai = createN8nActiveIA({ repo, webhookUrl: '' });
  const events = [];
  await ai.chat({ history: [{ role: 'user', content: 'oi' }], emit: (e) => events.push(e) });
  assert.equal(ai.configured, false);
  assert.match(events[0].message, /N8N_WEBHOOK_URL/);
});

test('com includeContext=false envia só a pergunta como mensagem', async () => {
  replyWith = { payload: { output: 'ok' } };
  const ai = createN8nActiveIA({ repo, webhookUrl: url(), options: { includeContext: false } });
  await ai.chat({ history: [{ role: 'user', content: 'erro 105?' }], emit: () => {} });
  assert.equal(received.body.chatInput, 'erro 105?');
  assert.match(received.body.prompt, /Manual impressora fiscal/);
});
