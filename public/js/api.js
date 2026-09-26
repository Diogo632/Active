async function request(method, url, body) {
  const options = { method, headers: {} };
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

const qs = (params) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : '';
};

export const api = {
  stats: () => request('GET', '/api/stats'),
  tags: () => request('GET', '/api/tags'),
  categories: () => request('GET', '/api/categories'),
  createCategory: (data) => request('POST', '/api/categories', data),
  updateCategory: (id, data) => request('PUT', `/api/categories/${id}`, data),
  deleteCategory: (id) => request('DELETE', `/api/categories/${id}`),

  items: (params = {}) => request('GET', `/api/items${qs(params)}`),
  item: (id, { view = false } = {}) => request('GET', `/api/items/${id}${view ? '?view' : ''}`),
  createArticle: (data) => request('POST', '/api/articles', data),
  updateItem: (id, data) => request('PUT', `/api/items/${id}`, data),
  deleteItem: (id) => request('DELETE', `/api/items/${id}`),

  /** Envia arquivos com barra de progresso (fetch não informa progresso de upload). */
  upload(url, formData, onProgress, method = 'POST') {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* resposta sem JSON */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || `Erro ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error('Falha de conexão durante o envio.'));
      xhr.send(formData);
    });
  },

  /** Conversa com a Active AI; `onEvent` recebe cada evento do stream SSE. */
  async chat({ messages, contextItemId, sessionId, mode, signal, onEvent }) {
    const res = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context_item_id: contextItemId, session_id: sessionId, mode }),
      signal,
    });
    if (!res.ok || !res.body) throw new Error(`Erro ${res.status} ao falar com a Active AI.`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (line) onEvent(JSON.parse(line.slice(6)));
      }
    }
  },
};
