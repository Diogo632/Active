import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { looksUnanswered } from '../server/gaps.js';
import { parseChapters, buildChaptersPrompt } from '../server/chapters.js';
import { parseYouTubeId, parseCaptionXml, pickCaptionTrack } from '../server/youtube.js';
import { normalizeTranscript } from '../server/transcribe.js';

let dataDir;
let server;
let base;
let repo;
let db;
const prompts = [];
let aiReply = () => 'ok';

before(async () => {
  process.env.INTEGRATION_TOKEN = 'tok-teste';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-melhorias-'));
  // Active AI simulada: registra os pedidos e responde com o texto definido em cada teste.
  const ai = {
    configured: true,
    model: 'teste',
    chat: async ({ history, emit }) => {
      const prompt = history[history.length - 1].content;
      prompts.push(prompt);
      emit({ type: 'text', text: aiReply(prompt) });
    },
  };
  // YouTube simulado (o ambiente de testes não acessa a internet).
  const youtubeClient = {
    info: async (id) => {
      if (id === 'privadoXXXX') throw Object.assign(new Error('Este vídeo é privado ou não permite ser incorporado.'), { status: 400 });
      return { title: 'Treinamento de emissão de CT-e', channel: 'Active Corp' };
    },
    transcript: async (id) =>
      id === 'semLegendas'
        ? { chunks: [], duration: 60 }
        : {
            chunks: [
              { start: 0, text: 'Bom dia, hoje vamos emitir um CT-e.' },
              { start: 40, text: 'Primeiro cadastre o cliente.' },
              { start: 75, text: 'Depois transmita para a SEFAZ.' },
            ],
            duration: 120,
          },
    downloadAudio: async () => null,
  };
  const created = createApp({ dataDir, ai, youtubeClient, transcriptionEngine: async () => [], reviewMonthsDefault: 6 });
  ({ repo, db } = created);
  await new Promise((r) => (server = created.app.listen(0, r)));
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

const waitFor = async (fn, ms = 5000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('tempo esgotado');
};

test('histórico de versões: cada edição guarda a versão anterior e dá para restaurar', async () => {
  const { body: doc } = await json('POST', '/api/articles', { title: 'Cancelamento de CT-e', content: 'Versão 1', author: 'Ana' });
  await json('PUT', `/api/items/${doc.id}`, { content: 'Versão 2', author: 'Bruno' });
  await json('PUT', `/api/items/${doc.id}`, { content: 'Versão 3', author: 'Carla' });
  // Mudar só a categoria/autor não cria versão.
  await json('PUT', `/api/items/${doc.id}`, { author: 'Carla' });

  const { body: versions } = await json('GET', `/api/items/${doc.id}/versions`);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].author, 'Bruno');
  const { body: v1 } = await json('GET', `/api/items/${doc.id}/versions/${versions[1].id}`);
  assert.equal(v1.content, 'Versão 1');

  const { body: restored } = await json('POST', `/api/items/${doc.id}/versions/${v1.id}/restore`, { author: 'Diego' });
  assert.equal(repo.getItem(restored.id, { full: true }).content, 'Versão 1');
  const { body: after } = await json('GET', `/api/items/${doc.id}`);
  assert.equal(after.versions_count, 3, 'a versão 3 também foi guardada antes de restaurar');
});

test('data de revisão: textos novos revisam a cada 6 meses e avisam quando vencem', async () => {
  const { body: doc } = await json('POST', '/api/articles', { title: 'Procedimento antigo de EDI', content: 'Envie o arquivo pelo FTP.' });
  assert.equal(doc.review_months, 6);
  assert.equal(doc.review_overdue, false);

  db.prepare("UPDATE items SET updated_at = datetime('now', '-7 months') WHERE id = ?").run(doc.id);
  const { body: old } = await json('GET', `/api/items/${doc.id}`);
  assert.equal(old.review_overdue, true);
  const { body: due } = await json('GET', '/api/items?revisar');
  assert.ok(due.items.some((i) => i.id === doc.id));
  assert.ok((await json('GET', '/api/stats')).body.review_due >= 1);

  const { body: reviewed } = await json('POST', `/api/items/${doc.id}/reviewed`);
  assert.equal(reviewed.review_overdue, false);

  // Sem revisão periódica.
  const { body: none } = await json('PUT', `/api/items/${doc.id}`, { review_months: '' });
  assert.equal(none.review_months, null);
});

test('lacunas: busca sem resultado, resposta sem informação, avaliação negativa e o agente pelo MCP', async () => {
  // Busca rápida (sem "registrar") não conta; busca feita pela pessoa conta.
  await json('GET', '/api/items?q=frete%20retorno%20devolucao');
  await json('GET', '/api/items?q=Frete%20retorno%20devolução&registrar=1');
  await json('GET', '/api/items?q=frete%20retorno%20devolucao&registrar=1'); // repetida em seguida: conta uma vez

  // A Active AI diz que não encontrou.
  aiReply = () => 'Não encontrei informações sobre isso na base de conhecimento.';
  const res = await fetch(`${base}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Como configurar o certificado A3?' }], mode: 'livre' }),
  });
  await res.text();
  aiReply = () => 'ok';

  // Resposta avaliada como "não ajudou".
  const fb = await json('POST', '/api/feedback', { target: 'resposta', helpful: false, question: 'Qual o prazo do MDF-e?', answer: 'x', comment: 'Resposta genérica' });
  assert.equal(fb.status, 201);

  // O agente avisa pelo MCP.
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'teste', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: 'Bearer tok-teste' } } }));
  const out = await client.callTool({ name: 'registrar_lacuna', arguments: { pergunta: 'Como configurar o certificado A3?', detalhe: 'Busquei "certificado" e "A3"' } });
  assert.match(out.content[0].text, /registrada/);
  await client.close();

  const { body: report } = await json('GET', '/api/relatorio');
  const find = (q) => report.gaps.find((g) => g.normalized === q);
  assert.equal(find('frete retorno devolucao').count, 1);
  assert.deepEqual(find('frete retorno devolucao').sources, ['busca']);
  const a3 = find('como configurar o certificado a3');
  assert.equal(a3.count, 2);
  assert.deepEqual([...a3.sources].sort(), ['agente', 'ia']);
  assert.ok(a3.details.some((d) => d.detail.includes('certificado')));
  assert.equal(find('qual o prazo do mdf e').sources[0], 'avaliacao');
  assert.equal(report.feedback.answers[0].comment, 'Resposta genérica');

  // Escrever o documento resolve a lacuna.
  const { body: doc } = await json('POST', '/api/articles', { title: 'Certificado A3', content: '...' });
  await json('POST', '/api/lacunas/resolver', { pergunta: 'Como configurar o certificado A3?', item_id: doc.id });
  const { body: after } = await json('GET', '/api/relatorio');
  assert.ok(!after.gaps.some((g) => g.normalized === 'como configurar o certificado a3'));
  const { body: resolved } = await json('GET', '/api/relatorio?resolvidas');
  assert.equal(resolved.gaps.find((g) => g.normalized === 'como configurar o certificado a3').resolved_item_id, doc.id);
});

test('"Isso ajudou?" nos documentos', async () => {
  const { body: doc } = await json('POST', '/api/articles', { title: 'Reimpressão de DACTE', content: 'Menu Fiscal > Reimprimir.' });
  await json('POST', '/api/feedback', { target: 'documento', item_id: doc.id, helpful: true });
  await json('POST', '/api/feedback', { target: 'documento', item_id: doc.id, helpful: false, comment: 'Falta a tela nova' });
  assert.equal((await json('POST', '/api/feedback', { target: 'documento', item_id: 99999, helpful: true })).status, 404);
  const { body: item } = await json('GET', `/api/items/${doc.id}`);
  assert.deepEqual(item.feedback, { up: 1, down: 1 });
  const { body: report } = await json('GET', '/api/relatorio');
  const row = report.feedback.docs.find((d) => d.id === doc.id);
  assert.deepEqual(row.comments, ['Falta a tela nova']);
});

test('identifica respostas em que a Active AI não encontrou a informação', () => {
  assert.ok(looksUnanswered('Não encontrei nenhum documento sobre esse assunto.'));
  assert.ok(looksUnanswered('Infelizmente não há informações na base sobre o certificado A3.'));
  assert.ok(looksUnanswered('Não tenho essa informação no momento.'));
  assert.ok(!looksUnanswered('Para emitir o CT-e, acesse o menu Fiscal e clique em Emitir.'));
  assert.ok(!looksUnanswered('Não esqueça de salvar antes de transmitir.'));
});

test('capítulos: lê o formato devolvido pelo agente', () => {
  const reply = `RESUMO: Treinamento sobre emissão de CT-e, do cadastro à transmissão.
CAPITULOS:
[00:00:00] Abertura
- [00:00:40] **Cadastro do cliente**
00:01:15 — Transmissão para a SEFAZ
[01:30:00] Fora do vídeo`;
  const { summary, chapters } = parseChapters(reply, 120);
  assert.equal(summary, 'Treinamento sobre emissão de CT-e, do cadastro à transmissão.');
  assert.deepEqual(chapters, [
    { start: 0, title: 'Abertura' },
    { start: 40, title: 'Cadastro do cliente' },
    { start: 75, title: 'Transmissão para a SEFAZ' },
  ]);
  // Transcrição longa: pede para o agente ler pelo MCP, e a mensagem cabe no limite do GPTMaker.
  const long = buildChaptersPrompt({ id: 7, title: 'Aula', duration: 3600 }, '[00:00:00] texto '.repeat(2000));
  assert.ok(long.length < 3500);
  assert.match(long, /ler_documento.*id 7/);
  const short = buildChaptersPrompt({ id: 8, title: 'Aula curta' }, '[00:00:00] Olá');
  assert.match(short, /Transcrição:\n\[00:00:00\] Olá/);
});

test('YouTube: links, legendas e transcrição copiada do site', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s',
    'https://youtu.be/dQw4w9WgXcQ?si=abc',
    'youtube.com/shorts/dQw4w9WgXcQ',
    'https://m.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
  ]) {
    assert.equal(parseYouTubeId(url), 'dQw4w9WgXcQ', url);
  }
  assert.equal(parseYouTubeId('https://vimeo.com/123'), null);

  assert.deepEqual(parseCaptionXml('<transcript><text start="1.5" dur="2">Olá &amp;#39;pessoal&amp;#39;</text><text start="4" dur="1">tudo &amp;amp; bem</text></transcript>'), [
    { start: 1.5, text: "Olá 'pessoal'" },
    { start: 4, text: 'tudo & bem' },
  ]);
  assert.deepEqual(parseCaptionXml('<timedtext><body><p t="61000" d="2000"><s>Tela</s><s> 619</s></p></body></timedtext>'), [{ start: 61, text: 'Tela 619' }]);
  assert.equal(pickCaptionTrack([{ languageCode: 'en' }, { languageCode: 'pt', kind: 'asr' }, { languageCode: 'pt-BR' }]).languageCode, 'pt-BR');

  // Texto copiado de "Mostrar transcrição" no YouTube.
  assert.equal(normalizeTranscript('0:00\nBom dia\n0:05\npessoal\n1:02\nAgora o CT-e'), '[00:00:00] Bom dia pessoal\n[00:01:02] Agora o CT-e');
  assert.equal(normalizeTranscript('Texto sem horários.\nOutra linha.'), 'Texto sem horários.\nOutra linha.');
});

test('vídeo do YouTube: entra na base, usa as legendas e ganha resumo e capítulos da Active AI', async () => {
  aiReply = (prompt) =>
    /CAPITULOS/.test(prompt) ? 'RESUMO: Como emitir um CT-e.\nCAPITULOS:\n[00:00:00] Abertura\n[00:00:40] Cadastro do cliente\n[00:01:15] Transmissão' : 'ok';
  const created = await json('POST', '/api/youtube', { url: 'https://youtu.be/AbCdEfGhIjK', tags: 'treinamento' });
  assert.equal(created.status, 201);
  assert.equal(created.body.kind, 'youtube');
  assert.equal(created.body.title, 'Treinamento de emissão de CT-e');
  assert.equal(created.body.source_url, 'https://www.youtube.com/watch?v=AbCdEfGhIjK');

  const done = await waitFor(async () => {
    const it = (await json('GET', `/api/items/${created.body.id}?full`)).body;
    return it.chapters_status === 'ok' || it.chapters_status === 'erro' ? it : null;
  });
  assert.equal(done.media_status, 'legendas');
  assert.equal(done.duration, 120);
  assert.match(done.text_full, /^\[00:00:00\] Bom dia, hoje vamos emitir um CT-e\.\n\[00:00:40\] Primeiro cadastre o cliente\./);
  assert.equal(done.chapters_status, 'ok', done.chapters_error);
  assert.equal(done.ai_summary, 'Como emitir um CT-e.');
  assert.equal(done.chapters.length, 3);

  // Pesquisável pela transcrição e pelos capítulos; o MCP entrega capítulos e o link do vídeo.
  const found = (await json('GET', '/api/items?q=transmita%20SEFAZ')).body.items;
  assert.equal(found[0].id, done.id);
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'teste', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: 'Bearer tok-teste' } } }));
  const read = JSON.parse((await client.callTool({ name: 'ler_documento', arguments: { id: done.id } })).content[0].text);
  await client.close();
  assert.equal(read.tipo, 'vídeo do YouTube (transcrição)');
  assert.equal(read.video_youtube, 'https://www.youtube.com/watch?v=AbCdEfGhIjK');
  assert.deepEqual(read.capitulos, ['00:00:00 Abertura', '00:00:40 Cadastro do cliente', '00:01:15 Transmissão']);

  // O mesmo vídeo de novo: recusado, informando o documento existente.
  const dup = await json('POST', '/api/youtube', { url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK' });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.item.id, done.id);
  assert.equal((await json('POST', '/api/youtube', { url: 'https://example.com' })).status, 400);
  assert.equal((await json('POST', '/api/youtube', { url: 'https://youtu.be/privadoXXXX' })).status, 400);
});

test('vídeo do YouTube sem legendas: pede a transcrição colada', async () => {
  const { body } = await json('POST', '/api/youtube', { url: 'https://youtu.be/semLegendas' });
  const failed = await waitFor(async () => {
    const it = (await json('GET', `/api/items/${body.id}`)).body;
    return it.media_status === 'erro' ? it : null;
  });
  assert.match(failed.media_error, /Mostrar transcrição/);

  const pasted = await json('PUT', `/api/items/${body.id}/transcript`, { text: '0:00\nOlá\n0:31\nTela 619' });
  assert.equal(pasted.status, 200);
  assert.equal(pasted.body.media_status, 'manual');
  assert.equal(repo.getItem(body.id, { full: true }).text, '[00:00:00] Olá\n[00:00:31] Tela 619');
});

test('anexo na conversa: fica temporário na plataforma e o agente recebe só o id para ler pelo MCP', async () => {
  const conteudo = `Contrato de prestação de serviços Selmi.\n${'Cláusula de SLA e multas. '.repeat(600)}\nFim do contrato.`;
  const fd = new FormData();
  fd.append('file', new Blob([conteudo], { type: 'text/plain' }), 'contrato-selmi.txt');
  const up = await fetch(`${base}/api/chat/anexos`, { method: 'POST', body: fd });
  assert.equal(up.status, 201);
  const anexo = await up.json();
  assert.equal(anexo.temporary, 1);
  assert.ok(anexo.expires_at);
  assert.ok(Math.abs(anexo.text_length - conteudo.length) <= 2);

  // Fora das listas e da busca da base.
  assert.ok(!(await json('GET', '/api/items?q=contrato%20selmi')).body.items.some((i) => i.id === anexo.id));
  assert.ok(!(await json('GET', '/api/items?limit=200')).body.items.some((i) => i.id === anexo.id));

  // A mensagem para o agente leva a referência curta, não o conteúdo.
  prompts.length = 0;
  aiReply = () => 'ok';
  const res = await fetch(`${base}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Qual a multa do SLA?' }], mode: 'livre', attachments: [anexo.id] }),
  });
  await res.text();
  const sent = prompts.at(-1);
  assert.match(sent, new RegExp(`id ${anexo.id}: “contrato-selmi\\.txt”`));
  assert.match(sent, /ler_documento/);
  assert.match(sent, /Qual a multa do SLA\?$/);
  assert.ok(sent.length < 1000, 'o conteúdo do arquivo não vai na mensagem');

  // O agente lê o arquivo inteiro pelo MCP.
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'teste', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: 'Bearer tok-teste' } } }));
  const read = JSON.parse((await client.callTool({ name: 'ler_documento', arguments: { id: anexo.id } })).content[0].text);
  // Id enviado como texto ("6" ou "#6") também funciona.
  for (const id of [String(anexo.id), `#${anexo.id}`]) {
    const out = await client.callTool({ name: 'ler_documento', arguments: { id, inicio: '0' } });
    assert.ok(!out.isError, `id ${id}`);
    assert.equal(JSON.parse(out.content[0].text).id, anexo.id);
  }
  await client.close();
  assert.equal(read.total_caracteres, anexo.text_length);
  assert.ok(read.anexo_da_conversa);

  // Vence e é apagado; ou pode ser mantido na base.
  db.prepare("UPDATE items SET expires_at = datetime('now', '-1 minute') WHERE id = ?").run(anexo.id);
  assert.deepEqual(repo.expiredTemporary(), [anexo.id]);
  const { body: kept } = await json('POST', `/api/items/${anexo.id}/keep`);
  assert.equal(kept.temporary, 0);
  assert.deepEqual(repo.expiredTemporary(), []);
  assert.ok((await json('GET', '/api/items?q=contrato%20selmi')).body.items.some((i) => i.id === anexo.id));
});

test('YouTube: tenta outros clientes quando um é bloqueado e explica a falha', async () => {
  const { createYouTubeClient } = await import('../server/youtube.js');
  const xml = '<transcript><text start="0" dur="2">Roteirização automática</text><text start="40" dur="2">Montando as rotas</text></transcript>';
  const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const blocked = { playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you’re not a bot' } };
  const fakeFetch = (behavior) => async (url, init = {}) => {
    if (url.includes('/youtubei/v1/player')) return reply(behavior(JSON.parse(init.body).context.client.clientName));
    if (url.includes('/watch')) return reply('<html>sem dados</html>');
    if (url.includes('timedtext')) return reply(xml);
    throw new Error('url inesperada');
  };

  // ANDROID bloqueado, IOS devolve as legendas.
  const ok = await createYouTubeClient({
    fetchImpl: fakeFetch((client) =>
      client === 'IOS'
        ? { playabilityStatus: { status: 'OK' }, videoDetails: { lengthSeconds: '754' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=x&fmt=srv3', languageCode: 'pt', kind: 'asr' }] } } }
        : blocked,
    ),
  }).transcript('AbCdEfGhIjK');
  assert.equal(ok.chunks.length, 2);
  assert.equal(ok.duration, 754);

  // Todos bloqueados: o motivo é "bloqueado" (não "sem legendas").
  const all = await createYouTubeClient({ fetchImpl: fakeFetch(() => blocked) }).transcript('AbCdEfGhIjK');
  assert.equal(all.failure, 'bloqueado');
  assert.match(all.attempts, /ANDROID: LOGIN_REQUIRED/);

  // O vídeo respondeu, mas não tem legendas.
  const none = await createYouTubeClient({ fetchImpl: fakeFetch(() => ({ playabilityStatus: { status: 'OK' }, videoDetails: { lengthSeconds: '60' } })) }).transcript('AbCdEfGhIjK');
  assert.equal(none.failure, 'sem_legendas');
});

test('transcrição colada do YouTube com o horário por extenso', () => {
  assert.equal(
    normalizeTranscript('0:00\n0 segundos\nBom dia\n1:05\n1 minuto e 5 segundos\nAgora as rotas'),
    '[00:00:00] Bom dia\n[00:01:05] Agora as rotas',
  );
});

test('transcrição do Teams em .docx: nome de quem fala e horário viram trechos', () => {
  const docx = 'Passagem de Bastão | Transbig\n9 de setembro de 2026, 13:00\n57m 3s\n\nAna Martins   começou a transcrição\n\nDiogo Albuquerque   0:03\nBoa tarde.\n\nAna Martins   0:35\nHoje vamos ver a emissão do CT-e.\nE o cadastro.\n';
  assert.equal(
    normalizeTranscript(docx, 'reuniao.docx'),
    '[00:00:03] Diogo Albuquerque: Boa tarde.\n[00:00:35] Ana Martins: Hoje vamos ver a emissão do CT-e. E o cadastro.',
  );
});

test('gravação do Teams: link + transcrição; o vídeo fica no SharePoint e o agente lê a transcrição', async () => {
  const link =
    'https://activecorpcombr-my.sharepoint.com/personal/ana_martins_activecorp_com_br/_layouts/15/stream.aspx?id=%2Fpersonal%2Fana_martins_activecorp_com_br%2FDocuments%2FRecordings%2FPassagem%20de%20Bast%C3%A3o%20Transbig-20260909_130000-Grava%C3%A7%C3%A3o%20de%20Reuni%C3%A3o.mp4';
  const send = (fields, transcript) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    if (transcript) fd.append('transcript', new Blob([transcript], { type: 'text/vtt' }), 'reuniao.vtt');
    return fetch(`${base}/api/teams`, { method: 'POST', body: fd });
  };

  assert.equal((await send({ url: 'https://exemplo.com/video.mp4' })).status, 400, 'só links da Microsoft');
  assert.equal((await send({ url: link, embed: '<iframe src="https://exemplo.com/embed"></iframe>' })).status, 400, 'player só do SharePoint');

  const vtt = 'WEBVTT\n\n00:00:03.000 --> 00:00:06.000\n<v Diogo Albuquerque>Boa tarde, pessoal.</v>\n\n00:01:10.000 --> 00:01:15.000\n<v Ana Martins>A Transbig emite o MDF-e pela tela 410.</v>\n';
  const res = await send({ url: link, embed: '<iframe src="https://activecorpcombr-my.sharepoint.com/personal/ana/_layouts/15/embed.aspx?UniqueId=abc&amp;embed=%7B%7D" width="640"></iframe>' }, vtt);
  assert.equal(res.status, 201);
  const item = await res.json();
  assert.equal(item.kind, 'teams');
  assert.equal(item.title, 'Passagem de Bastão Transbig', 'título tirado do nome da gravação');
  assert.equal(item.media_status, 'manual');
  assert.match(item.embed_url, /^https:\/\/activecorpcombr-my\.sharepoint\.com\/.*embed\.aspx\?UniqueId=abc&embed=/);
  assert.equal((await send({ url: link })).status, 409, 'a mesma gravação não entra duas vezes');

  const found = await json('GET', '/api/items?q=MDF-e%20tela%20410');
  assert.equal(found.body.items[0].id, item.id);
  const filtered = await json('GET', '/api/items?kind=teams');
  assert.deepEqual(filtered.body.items.map((i) => i.id), [item.id]);

  // Sem transcrição: fica aguardando o arquivo; o player pode ser trocado depois.
  const other = await (await send({ url: `${link.replace('Transbig', 'Selmi')}`, title: 'Treinamento Selmi' })).json();
  assert.equal(other.media_status, 'aguarda');
  assert.equal(other.embed_url, null);
  assert.equal((await json('PUT', `/api/items/${other.id}/player`, { embed: 'https://evil.com/_layouts/15/embed.aspx' })).status, 400);
  const withPlayer = await json('PUT', `/api/items/${other.id}/player`, { embed: 'https://activecorpcombr-my.sharepoint.com/_layouts/15/embed.aspx?UniqueId=x' });
  assert.equal(withPlayer.body.embed_url, 'https://activecorpcombr-my.sharepoint.com/_layouts/15/embed.aspx?UniqueId=x');

  // O player do SharePoint é permitido pela política de conteúdo da página.
  const page = await fetch(`${base}/`);
  assert.match(page.headers.get('content-security-policy'), /frame-src [^;]*https:\/\/\*\.sharepoint\.com/);
});
