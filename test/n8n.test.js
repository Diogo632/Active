import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, createRepository } from '../server/db.js';
import { createN8nActiveIA, extractReply, extractOptions, keywords, bestExcerpts, splitSource } from '../server/n8n.js';

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
      const { status = 200, payload } = typeof replyWith === 'function' ? replyWith(received) : replyWith;
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
  assert.match(received.body.prompt, /ler_documento/);
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
  assert.equal(received.body.prompt, 'erro 105?');
  assert.deepEqual(received.body.documentos, []);
});

test('documento aberto longo não é enviado inteiro: vai a referência para o agente ler pelo MCP', async () => {
  const longo = `Início do processo. ${'Detalhe do cálculo. '.repeat(1500)} Quilometragem utilizada no cálculo. Passo final: faturar.`;
  const doc = repo.createItem({ kind: 'article', title: 'Processo longo', content: longo });
  replyWith = { payload: { message: 'ok' } };
  await ask('Resuma este documento', { contextItemId: doc.id });
  const prompt = received.body.prompt;
  assert.ok(prompt.length <= 3500, `prompt com ${prompt.length} caracteres`);
  assert.match(prompt, new RegExp(`Documento aberto na tela: #${doc.id}`));
  assert.match(prompt, /ler_documento/);
  assert.match(prompt, /Pergunta: Resuma este documento$/);
  const enviado = received.body.documentos.find((d) => d.id === doc.id);
  assert.equal(enviado.parcial, true);
  assert.equal(enviado.total_caracteres, longo.length);
});

test('mensagem respeita o limite mesmo com muitos documentos encontrados', async () => {
  for (let i = 0; i < 8; i++) repo.createItem({ kind: 'article', title: `Manual zebra ${i}`, content: `zebra ${'texto longo '.repeat(400)}` });
  replyWith = { payload: { message: 'ok' } };
  await ask('Como funciona a zebra?');
  assert.ok(received.body.prompt.length <= 3500);
  assert.match(received.body.prompt, /Manual zebra/);
});

test('conversa livre também prioriza a base da plataforma: vai a regra de fonte e os documentos', async () => {
  replyWith = { payload: { message: 'ok' } };
  await ask('Qual o prazo de SLA do cliente X?', { mode: 'livre' });
  const prompt = received.body.prompt;
  assert.match(prompt, /REGRA DE FONTE/);
  assert.match(prompt, /\[FONTE: BASE GERAL\]/);
  assert.match(prompt, /não encontrou documentos/);
  assert.match(prompt, /Pergunta: Qual o prazo de SLA do cliente X\?$/);

  await ask('Como configurar a impressora fiscal?', { mode: 'livre' });
  assert.match(received.body.prompt, /Documentos da plataforma relacionados \(use estes primeiro\)/);
  assert.ok(received.body.documentos.length > 0);
});

test('resposta da base própria do GPT Maker: a marcação some do texto e vira aviso', async () => {
  replyWith = { payload: { message: '[FONTE: BASE GERAL]\nO SLA padrão do cliente X é de 4 horas.' } };
  const events = await ask('Qual o SLA do cliente X?', { mode: 'livre' });
  assert.deepEqual(events.find((e) => e.type === 'origin'), { type: 'origin', origin: 'geral' });
  assert.equal(events.find((e) => e.type === 'text').text, 'O SLA padrão do cliente X é de 4 horas.');

  // Resposta longa sem citar nenhum documento da plataforma: aviso para conferir.
  replyWith = { payload: { message: `Para emitir, siga os passos. ${'Detalhe do procedimento. '.repeat(20)}` } };
  const uncited = await ask('Como emitir?', { mode: 'livre' });
  assert.equal(uncited.find((e) => e.type === 'origin').origin, 'sem_citacao');

  // Citando a base: sem aviso.
  replyWith = { payload: { message: `Veja [Manual](#/item/1). ${'Detalhe do procedimento. '.repeat(20)}` } };
  const cited = await ask('Como emitir?', { mode: 'livre' });
  assert.ok(!cited.some((e) => e.type === 'origin'));
});

test('splitSource reconhece a marcação com variações', () => {
  assert.equal(splitSource('[Fonte: Base geral do GPT Maker] Resposta.').origin, 'geral');
  assert.equal(splitSource('[Fonte: Base geral do GPT Maker] Resposta.').answer, 'Resposta.');
  assert.equal(splitSource('[ FONTE : BASE GERAL ]\n\nTexto').answer, 'Texto');
  assert.equal(splitSource('Oi! Como posso ajudar?').origin, 'base');
});

test('modo livre com documento em foco envia o documento', async () => {
  replyWith = { payload: { message: 'ok' } };
  await ask('Resuma', { mode: 'livre', contextItemId: 1 });
  assert.equal(received.body.documentos[0].id, 1);
  assert.match(received.body.prompt, /Manual impressora fiscal/);
});

test('extractOptions lê botões enviados pelo workflow', () => {
  assert.deepEqual(extractOptions({ message: 'x', options: ['A', { label: 'B' }] }), ['A', 'B']);
  assert.deepEqual(extractOptions([{ json: { botoes: [{ text: 'C' }] } }]), ['C']);
  assert.deepEqual(extractOptions({ message: 'sem opções' }), []);
});

test('o rascunho <analise> do agente não aparece para a pessoa', async () => {
  replyWith = {
    payload: {
      message:
        '<analise>\nAção: alterar | Objeto: descrição do CST | Contexto: CT-e\nResponde exatamente? Não.\nDecisão: perguntar\n</analise>\n' +
        'Você quer alterar o código CST ou a descrição que aparece no DACTE?\n[OPCOES] Código CST | Descrição no DACTE',
    },
  };
  const events = await ask('como alterar a descrição de um CST no cte ?', { mode: 'livre' });
  const text = events.find((e) => e.type === 'text').text;
  assert.doesNotMatch(text, /analise|Objeto:|Decisão/i);
  assert.match(text, /^Você quer alterar o código CST/);
  assert.match(text, /\[OPCOES\] Código CST \| Descrição no DACTE$/);
  // O rascunho chega à tela separado, para o botão "!" mostrar quando a pessoa quiser.
  assert.match(events.find((e) => e.type === 'analysis').text, /^Ação: alterar \| Objeto: descrição do CST/);
});

test('splitAnalysis nunca esconde a resposta inteira', async () => {
  const { splitAnalysis } = await import('../server/n8n.js');
  assert.deepEqual(splitAnalysis('<análise>Ação: x\n\nResposta.'), { analysis: 'Ação: x', answer: 'Resposta.' });
  assert.equal(splitAnalysis('Sem rascunho.').answer, 'Sem rascunho.');
  assert.equal(splitAnalysis('<analise>Só o rascunho</analise>').answer, 'Só o rascunho');
});

test('o rascunho separado pelo n8n (campo "analise") também chega à tela', async () => {
  replyWith = { payload: [{ message: 'Você se refere a qual sistema?', analise: 'Ação: emitir\nDecisão: perguntar antes' }] };
  const events = await ask('Como emito um CT-e?', { mode: 'livre' });
  assert.equal(events.find((e) => e.type === 'text').text, 'Você se refere a qual sistema?');
  assert.equal(events.find((e) => e.type === 'analysis').text, 'Ação: emitir\nDecisão: perguntar antes');
});

test('resposta vazia do GPT Maker: tenta de novo uma vez e mostra a resposta da segunda tentativa', async () => {
  const prompts = [];
  replyWith = (req) => {
    prompts.push(req.body.prompt);
    return { payload: prompts.length === 1 ? { success: true, message: '', images: [] } : { message: 'Agora sim: troque a bobina.' } };
  };
  const events = await ask('Como resolver o erro 105?');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /^\[A tentativa anterior não gerou resposta/);
  assert.ok(events.some((e) => e.type === 'status' && /tentando de novo/.test(e.label)));
  assert.equal(events.find((e) => e.type === 'text').text, 'Agora sim: troque a bobina.');
  assert.ok(!events.some((e) => e.type === 'error'));
});

test('resposta vazia duas vezes: erro claro, sem culpar a configuração do n8n', async () => {
  replyWith = { payload: [{ json: { success: true, message: '' } }] };
  const events = await ask('Como resolver o erro 105?');
  assert.match(events.find((e) => e.type === 'error').message, /GPT Maker devolveu uma mensagem vazia/);
  replyWith = { payload: { outraCoisa: 1 } };
  const wrong = await ask('Como resolver o erro 105?');
  assert.match(wrong.find((e) => e.type === 'error').message, /Respond to Webhook/);
});
