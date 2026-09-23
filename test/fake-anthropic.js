// Servidor HTTP que imita o endpoint /v1/messages (streaming) da API da Anthropic,
// usado para testar o loop de ferramentas do Active IA sem chave real.
import http from 'node:http';

function sse(res, events) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`);
  res.end();
}

const start = (model) => [
  'message_start',
  {
    message: {
      id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model, content: [],
      stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 },
    },
  },
];

export function toolUseTurn(model, name, input) {
  return [
    start(model),
    ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Vou pesquisar na base.' } }],
    ['content_block_stop', { index: 0 }],
    ['content_block_start', { index: 1, content_block: { type: 'tool_use', id: `toolu_${name}`, name, input: {} } }],
    ['content_block_delta', { index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }],
    ['content_block_stop', { index: 1 }],
    ['message_delta', { delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', {}],
  ];
}

export function textTurn(model, text) {
  return [
    start(model),
    ['content_block_start', { index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { index: 0 }],
    ['message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } }],
    ['message_stop', {}],
  ];
}

/** `script` recebe o corpo de cada requisição e devolve a lista de eventos SSE da resposta. */
export function startFakeAnthropic(script) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const parsed = JSON.parse(body);
      requests.push({ url: req.url, headers: req.headers, body: parsed });
      sse(res, script(parsed, requests.length));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() });
    });
  });
}
