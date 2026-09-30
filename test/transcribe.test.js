import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { formatTranscript, parseSubtitles, normalizeTranscript, isMediaFile, formatTime } from '../server/transcribe.js';

let dataDir;
let server;
let base;
let repo;
let ffmpegOk = false;
const audioFile = () => path.join(dataDir, 'treinamento.wav');

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-video-'));
  // Transcritor simulado: devolve um trecho por parte de áudio recebida, com a duração da parte.
  const fakeEngine = async (samples) => [
    { start: 0, end: samples.length / 16000, text: `Neste treinamento mostramos a tela 619 (${Math.round(samples.length / 16000)}s).` },
  ];
  const created = createApp({ dataDir, ai: { configured: false, chat: async () => {} }, transcriptionEngine: fakeEngine });
  repo = created.repo;
  await new Promise((r) => (server = created.app.listen(0, r)));
  base = `http://127.0.0.1:${server.address().port}`;

  const { default: ff } = await import('@ffmpeg-installer/ffmpeg').catch(() => ({ default: null }));
  if (ff) {
    const r = spawnSync(ff.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4', audioFile()]);
    ffmpegOk = r.status === 0;
  }
});

after(() => {
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const waitFor = async (fn, ms = 10000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('tempo esgotado');
};

test('formatação e leitura de legendas', () => {
  assert.equal(formatTime(754.9), '00:12:34');
  assert.equal(
    formatTranscript([
      { start: 0, text: ' Olá ' },
      { start: 10, text: 'pessoal.' },
      { start: 45, text: 'Agora a tela 619.' },
    ]),
    '[00:00:00] Olá pessoal.\n[00:00:45] Agora a tela 619.',
  );
  const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n<v Ana>Bom dia a todos</v>\n\n00:01:05.500 --> 00:01:08.000\n<v Ana>Vamos ver o CT-e</v>';
  assert.deepEqual(parseSubtitles(vtt), [
    { start: 1, text: 'Ana: Bom dia a todos' },
    { start: 65.5, text: 'Ana: Vamos ver o CT-e' },
  ]);
  assert.equal(normalizeTranscript('1\n00:00:02,000 --> 00:00:03,000\nOi\n', 'x.srt'), '[00:00:02] Oi');
  assert.ok(isMediaFile('aula.MP4') && isMediaFile('x', 'audio/mpeg') && !isMediaFile('a.pdf', 'application/pdf'));
});

test('vídeo/áudio enviado é transcrito em segundo plano e fica pesquisável', async (t) => {
  if (!ffmpegOk) return t.skip('ffmpeg indisponível neste ambiente');
  const fd = new FormData();
  fd.append('files', new Blob([fs.readFileSync(audioFile())], { type: 'audio/wav' }), 'Treinamento Selmi.wav');
  const res = await fetch(`${base}/api/files`, { method: 'POST', body: fd });
  assert.equal(res.status, 201);
  const [item] = await res.json();
  assert.equal(item.extract_status, 'media');
  assert.ok(['pendente', 'processando'].includes(item.media_status));

  const done = await waitFor(async () => {
    const it = await (await fetch(`${base}/api/items/${item.id}`)).json();
    return it.media_status === 'concluida' || it.media_status === 'erro' ? it : null;
  });
  assert.equal(done.media_status, 'concluida', done.media_error);
  assert.ok(Math.abs(done.duration - 4) < 0.5);
  assert.match(done.text_preview, /^\[00:00:00\] Neste treinamento mostramos a tela 619 \(4s\)\.$/);

  const found = await (await fetch(`${base}/api/items?q=treinamento%20tela%20619`)).json();
  assert.equal(found.items[0].id, item.id);
});

test('transcrição enviada manualmente (.vtt do Teams) substitui a automática', async () => {
  const item = repo.createItem({ kind: 'file', title: 'Reunião', file_name: 'reuniao.mp4', stored_name: 'x.mp4', mime_type: 'video/mp4', size: 1, extract_status: 'media' });
  const fd = new FormData();
  fd.append('file', new Blob(['WEBVTT\n\n00:02:00.000 --> 00:02:03.000\n<v Rafaela>Explicando a quilometragem</v>']), 'reuniao.vtt');
  const res = await fetch(`${base}/api/items/${item.id}/transcript`, { method: 'PUT', body: fd });
  assert.equal(res.status, 200);
  const it = await (await fetch(`${base}/api/items/${item.id}`)).json();
  assert.equal(it.media_status, 'manual');
  assert.equal(it.text_preview, '[00:02:00] Rafaela: Explicando a quilometragem');
  assert.equal(it.text_full, undefined);
  const full = await (await fetch(`${base}/api/items/${item.id}?full=1`)).json();
  assert.equal(full.text_full, '[00:02:00] Rafaela: Explicando a quilometragem');
});

test('miniatura: quadro do vídeo enviado e capa do YouTube', async (t) => {
  if (!ffmpegOk) return t.skip('ffmpeg indisponível neste ambiente');
  const { default: ff } = await import('@ffmpeg-installer/ffmpeg');
  const video = path.join(dataDir, 'aula.mp4');
  spawnSync(ff.path, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10', '-pix_fmt', 'yuv420p', video]);
  const fd = new FormData();
  fd.append('files', new Blob([fs.readFileSync(video)], { type: 'video/mp4' }), 'aula.mp4');
  const [item] = await (await fetch(`${base}/api/files`, { method: 'POST', body: fd })).json();
  const res = await fetch(`${base}/api/items/${item.id}/thumb`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.ok((await res.arrayBuffer()).byteLength > 500);

  const yt = repo.createItem({ kind: 'youtube', title: 'YT', source_url: 'https://www.youtube.com/watch?v=AbCdEfGhIjK' });
  const redirect = await fetch(`${base}/api/items/${yt.id}/thumb`, { redirect: 'manual' });
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.get('location'), 'https://i.ytimg.com/vi/AbCdEfGhIjK/mqdefault.jpg');
  const doc = repo.createItem({ kind: 'article', title: 'Texto' });
  assert.equal((await fetch(`${base}/api/items/${doc.id}/thumb`)).status, 404);
});
