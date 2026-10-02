// Proteções HTTP da plataforma: cabeçalhos de segurança, bloqueio de requisições vindas de outros
// sites (CSRF) e limite de tentativas de senha/token erradas.

/**
 * Política de conteúdo da página: só scripts da própria plataforma; estilos e fontes do Google Fonts;
 * vídeos do YouTube incorporados. Reduz o estrago de qualquer XSS que escape da sanitização.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://i.ytimg.com",
  "media-src 'self' blob:",
  "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

/** Cabeçalhos aplicados a todas as respostas. */
export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  });
  next();
}

/**
 * Bloqueia ações (POST, PUT, DELETE…) disparadas por outro site com a sessão de quem está logado (CSRF).
 * O navegador informa a origem do pedido em Sec-Fetch-Site; pedidos da própria plataforma vêm como
 * "same-origin". Clientes fora do navegador (n8n, scripts) não mandam esse cabeçalho e seguem liberados,
 * pois continuam precisando da senha ou do token.
 */
export function blockCrossSiteWrites(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') {
    return res.status(403).json({ error: 'Requisição bloqueada: ela veio de outro site.' });
  }
  next();
}

/**
 * Limite de tentativas erradas (senha ou token) por endereço: depois de `max` erros em `windowMs`,
 * novas tentativas desse endereço recebem 429 até a janela passar. Acertos não contam.
 */
export function createFailureLimiter({ max = 10, windowMs = 10 * 60 * 1000 } = {}) {
  const failures = new Map(); // ip -> { count, resetAt }
  const keyOf = (req) => req.ip || req.socket?.remoteAddress || 'desconhecido';
  const entry = (req) => {
    const key = keyOf(req);
    const now = Date.now();
    let e = failures.get(key);
    if (!e || e.resetAt <= now) {
      e = { count: 0, resetAt: now + windowMs };
      failures.set(key, e);
    }
    return e;
  };
  // Limpeza periódica para o mapa não crescer sem limite.
  setInterval(() => {
    const now = Date.now();
    for (const [key, e] of failures) if (e.resetAt <= now) failures.delete(key);
  }, windowMs).unref();

  return {
    blocked(req, res) {
      const e = entry(req);
      if (e.count < max) return false;
      res.set('Retry-After', String(Math.ceil((e.resetAt - Date.now()) / 1000)));
      res.status(429).json({ error: 'Muitas tentativas com senha ou token errados. Aguarde alguns minutos e tente de novo.' });
      return true;
    },
    /** Igual a blocked(), sem responder (para quem monta a própria resposta, como a página de login). */
    isBlocked: (req) => entry(req).count >= max,
    fail(req) {
      entry(req).count += 1;
    },
  };
}
