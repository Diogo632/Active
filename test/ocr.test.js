import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, attachmentNote } from '../server/index.js';

// Leitura de texto de imagens (OCR) com o Tesseract de verdade: os dados de português e inglês vêm dos
// pacotes @tesseract.js-data, então o teste não depende de internet.
const here = path.dirname(fileURLToPath(import.meta.url));
const PRINT = path.join(here, 'fixtures', 'print-erro-n8n.png');

let dataDir;
let server;
let base;
let app;

before(async () => {
  process.env.INTEGRATION_TOKEN = 'token-de-teste-com-mais-de-trinta-e-dois-caracteres';
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-ocr-'));
  app = createApp({ dataDir, login: false, ocrEnabled: true, ai: { configured: false, chat: async () => {} } });
  await new Promise((r) => (server = app.app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await app.ocr.close();
  server?.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('print anexado na conversa: o texto é lido por OCR e o agente lê pelo MCP (e pode ver a imagem)', { timeout: 120_000 }, async () => {
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(PRINT)], { type: 'image/png' }), 'Screenshot_3n8n.png');
  const up = await fetch(`${base}/api/chat/anexos`, { method: 'POST', body: fd });
  assert.equal(up.status, 201);
  const anexo = await up.json();
  assert.ok(anexo.text_length > 50, `texto lido: ${anexo.text_length} caracteres`);

  const full = app.repo.getItem(anexo.id, { full: true });
  assert.match(full.text, /Enviar Romaneio/);
  assert.match(full.text, /48213/);
  assert.match(full.text, /ROM-409/);
  assert.match(attachmentNote([full]), /caracteres de texto lidos da imagem \(OCR\).*ver_imagem/);
  assert.match(attachmentNote([full]), /Texto lido da imagem: «.*ROM-409.*»/, 'o texto curto vai direto na mensagem');

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const client = new Client({ name: 'teste', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${process.env.INTEGRATION_TOKEN}` } } }));
  const read = JSON.parse((await client.callTool({ name: 'ler_documento', arguments: { id: anexo.id } })).content[0].text);
  assert.equal(read.tipo, 'imagem (texto lido por OCR)');
  assert.match(read.observacao, /OCR/);
  assert.match(read.conteudo, /ROM-409/);

  const seen = await client.callTool({ name: 'ver_imagem', arguments: { id: String(anexo.id) } });
  const image = seen.content.find((c) => c.type === 'image');
  assert.equal(image.mimeType, 'image/png');
  assert.equal(Buffer.from(image.data, 'base64').length, fs.statSync(PRINT).size);
  assert.equal((await client.callTool({ name: 'ver_imagem', arguments: { id: 999 } })).isError, true);
  await client.close();
});
