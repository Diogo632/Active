import crypto from 'node:crypto';
import * as oidc from 'openid-client';

/**
 * Login individual com a conta Microsoft (Entra ID) ou Google da empresa, por OpenID Connect.
 * Cada pessoa tem um perfil: "leitor" (consulta e usa a Active AI), "editor" (também cria e edita
 * documentos) ou "admin" (também gerencia as pessoas). Sessões em cookie HttpOnly, guardadas no banco.
 */

export const ROLES = ['leitor', 'editor', 'admin'];
const rank = (role) => ROLES.indexOf(role);
const COOKIE = 'kb_sessao';
const STATE_COOKIE = 'kb_login';

const list = (v) =>
  String(v || '')
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Provedores configurados pelo .env. */
export function providersFromEnv(env = process.env) {
  const providers = [];
  if (env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET && env.MICROSOFT_TENANT_ID) {
    providers.push({
      id: 'microsoft',
      label: 'Microsoft',
      issuer: `https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/v2.0`,
      clientId: env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
    });
  }
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.push({ id: 'google', label: 'Google', issuer: 'https://accounts.google.com', clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET });
  }
  if (env.OIDC_ISSUER && env.OIDC_CLIENT_ID) {
    providers.push({ id: 'oidc', label: env.OIDC_LABEL || 'conta da empresa', issuer: env.OIDC_ISSUER, clientId: env.OIDC_CLIENT_ID, clientSecret: env.OIDC_CLIENT_SECRET || '' });
  }
  return providers;
}

export function createAuth({ db, providers = providersFromEnv(), publicUrl = process.env.PUBLIC_URL || '', env = process.env, log = console }) {
  const enabled = providers.length > 0;
  const allowedDomains = list(env.AUTH_ALLOWED_DOMAINS);
  const admins = list(env.ADMIN_EMAILS);
  const defaultRole = ['editor', 'leitor'].includes(env.AUTH_DEFAULT_ROLE) ? env.AUTH_DEFAULT_ROLE : 'editor';
  const sessionDays = Math.max(1, Number(env.SESSION_DAYS) || 30);
  const pending = new Map(); // state -> { provider, verifier, nonce, returnTo, expires }
  const configs = new Map();

  const baseUrl = (req) => (publicUrl || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const isHttps = (req) => req.secure || baseUrl(req).startsWith('https://');
  const safeReturn = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/');

  async function configFor(provider) {
    if (!configs.has(provider.id)) {
      const url = new URL(provider.issuer);
      const insecure = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
      configs.set(
        provider.id,
        oidc.discovery(url, provider.clientId, provider.clientSecret || undefined, undefined, insecure ? { execute: [oidc.allowInsecureRequests] } : undefined).catch((err) => {
          configs.delete(provider.id);
          throw err;
        }),
      );
    }
    return configs.get(provider.id);
  }

  // ---------- Pessoas e sessões ----------
  const users = {
    list: () => db.prepare('SELECT id, email, name, provider, role, active, created_at, last_login_at FROM users ORDER BY name COLLATE NOCASE, email').all(),
    get: (id) => db.prepare('SELECT id, email, name, provider, role, active, created_at, last_login_at FROM users WHERE id = ?').get(id),
    update(id, { role, active }) {
      const current = users.get(id);
      if (!current) return null;
      db.prepare('UPDATE users SET role = ?, active = ? WHERE id = ?').run(
        ROLES.includes(role) ? role : current.role,
        active === undefined ? current.active : active ? 1 : 0,
        id,
      );
      if (active === false) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
      return users.get(id);
    },
    /** Cria ou atualiza a pessoa no login. Quem está em ADMIN_EMAILS é sempre admin. */
    upsert({ email, name, provider }) {
      const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      const isAdmin = admins.includes(email);
      if (existing) {
        db.prepare("UPDATE users SET name = ?, provider = ?, role = ?, last_login_at = datetime('now') WHERE id = ?").run(
          name || existing.name,
          provider,
          isAdmin ? 'admin' : existing.role,
          existing.id,
        );
        return users.get(existing.id);
      }
      // A primeira pessoa a entrar vira admin, para alguém conseguir gerenciar os perfis.
      const first = db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0;
      const id = db
        .prepare("INSERT INTO users (email, name, provider, role, last_login_at) VALUES (?, ?, ?, ?, datetime('now'))")
        .run(email, name || email, provider, isAdmin || first ? 'admin' : defaultRole).lastInsertRowid;
      return users.get(id);
    },
  };

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`).run(sha256(token), userId, `+${sessionDays} days`);
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
    return token;
  }

  function userFromRequest(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.active, s.expires_at, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
      )
      .get(sha256(token));
    if (!row || !row.active) return null;
    // Renova a sessão quando passa da metade do prazo (quem usa todo dia não precisa entrar de novo).
    const remainingDays = (Date.parse(`${row.expires_at.replace(' ', 'T')}Z`) - Date.now()) / 86_400_000;
    if (remainingDays < sessionDays / 2) {
      db.prepare(`UPDATE sessions SET expires_at = datetime('now', ?) WHERE token_hash = ?`).run(`+${sessionDays} days`, row.token_hash);
    }
    return { id: row.id, email: row.email, name: row.name, role: row.role };
  }

  const cookie = (req, name, value, maxAgeSeconds) =>
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${isHttps(req) ? '; Secure' : ''}`;

  // ---------- Página de login ----------
  const domainsText = () => allowedDomains.map((d) => `@${d}`).join(', ');
  const loginError = (code, providerId) =>
    ({
      expirado: 'O login expirou ou não foi iniciado nesta página. Tente de novo.',
      cancelado: 'O login foi cancelado. Tente de novo.',
      'sem-email': 'A conta não informou um e-mail.',
      'nao-verificado': 'O e-mail desta conta não está verificado.',
      dominio: `Esta conta não é da empresa. Entre com a sua conta ${domainsText()}.`,
      bloqueado: 'Seu acesso à Base de Conhecimento está desativado. Fale com um administrador.',
      falha: 'Não foi possível concluir o login. Tente de novo.',
      conexao: `Não foi possível conectar ao login${providers.find((p) => p.id === providerId) ? ` da ${providers.find((p) => p.id === providerId).label}` : ''}. Tente de novo em instantes.`,
    })[code] || '';

  const loginPage = (req, message = '') => {
    const volta = safeReturn(req.query.volta);
    const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Entrar · Base de Conhecimento Active</title><link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/css/styles.css" /></head>
<body class="login-body"><main class="login-card">
  <span class="brand-mark" aria-hidden="true">A</span>
  <h1>Base de Conhecimento</h1>
  <p class="muted">Suporte · Active Corp</p>
  ${message ? `<div class="msg-error">${esc(message)}</div>` : ''}
  <div class="login-buttons">${providers
    .map((p) => `<a class="btn btn-primary btn-block" href="/auth/${p.id}?volta=${encodeURIComponent(volta)}">Entrar com ${esc(p.label)}</a>`)
    .join('')}</div>
  <p class="muted small">Use a sua conta da empresa${allowedDomains.length ? ` (${esc(allowedDomains.map((d) => `@${d}`).join(', '))})` : ''}.</p>
</main></body></html>`;
  };

  // ---------- Rotas ----------
  function routes(app) {
    app.get('/entrar', (req, res) => {
      // Só mensagens conhecidas: um link com texto livre no ?erro= não aparece na página de login.
      res.set('Cache-Control', 'no-store').type('html').send(loginPage(req, loginError(String(req.query.erro || ''), String(req.query.provedor || ''))));
    });

    app.get('/auth/:provider', async (req, res) => {
      const provider = providers.find((p) => p.id === req.params.provider);
      if (!provider) return res.redirect('/entrar');
      try {
        const config = await configFor(provider);
        const verifier = oidc.randomPKCECodeVerifier();
        const state = oidc.randomState();
        const nonce = oidc.randomNonce();
        const now = Date.now();
        for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
        pending.set(state, { provider: provider.id, verifier, nonce, returnTo: safeReturn(req.query.volta), expires: now + 10 * 60_000 });
        const url = oidc.buildAuthorizationUrl(config, {
          redirect_uri: `${baseUrl(req)}/auth/${provider.id}/callback`,
          scope: 'openid email profile',
          code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
          code_challenge_method: 'S256',
          state,
          nonce,
          ...(provider.id === 'microsoft' || provider.id === 'google' ? { prompt: 'select_account' } : {}),
        });
        res.set('Set-Cookie', cookie(req, STATE_COOKIE, state, 600));
        res.redirect(url.href);
      } catch (err) {
        log.error(`[login] Falha ao iniciar o login com ${provider.label}:`, err.message);
        res.redirect(`/entrar?erro=conexao&provedor=${encodeURIComponent(provider.id)}`);
      }
    });

    app.get('/auth/:provider/callback', async (req, res) => {
      const provider = providers.find((p) => p.id === req.params.provider);
      const state = String(req.query.state || '');
      const flow = pending.get(state);
      const fail = (code) => res.redirect(`/entrar?erro=${code}`);
      if (!provider || !flow || flow.provider !== provider.id || flow.expires < Date.now() || parseCookies(req.headers.cookie)[STATE_COOKIE] !== state) {
        return fail('expirado');
      }
      pending.delete(state);
      if (req.query.error) {
        log.error(`[login] ${provider.label} recusou o login: ${String(req.query.error_description || req.query.error).slice(0, 300)}`);
        return fail('cancelado');
      }
      try {
        const config = await configFor(provider);
        const current = new URL(`${baseUrl(req)}${req.originalUrl}`);
        const tokens = await oidc.authorizationCodeGrant(config, current, { pkceCodeVerifier: flow.verifier, expectedState: state, expectedNonce: flow.nonce });
        const claims = tokens.claims() || {};
        const email = String(claims.email || claims.preferred_username || claims.upn || '').toLowerCase();
        if (!email.includes('@')) return fail('sem-email');
        if (claims.email_verified === false) return fail('nao-verificado');
        if (allowedDomains.length && !allowedDomains.includes(email.split('@')[1])) {
          log.log(`[login] ${email} recusado: fora dos domínios permitidos`);
          return fail('dominio');
        }
        const user = users.upsert({ email, name: String(claims.name || claims.given_name || email.split('@')[0]), provider: provider.id });
        if (!user.active) return fail('bloqueado');
        const token = createSession(user.id);
        log.log(`[login] ${user.email} entrou (${provider.label}, perfil ${user.role})`);
        res.set('Set-Cookie', [cookie(req, COOKIE, token, sessionDays * 86400), cookie(req, STATE_COOKIE, '', 0)]);
        res.redirect(flow.returnTo);
      } catch (err) {
        log.error(`[login] Falha no retorno do login com ${provider.label}:`, err.message);
        fail('falha');
      }
    });

    app.post('/auth/sair', (req, res) => {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
      res.set('Set-Cookie', cookie(req, COOKIE, '', 0));
      res.json({ ok: true, login: '/entrar' });
    });
  }

  /** Exige login em tudo, exceto a página de login e os arquivos dela. */
  function requireUser(req, res, next) {
    if (req.path === '/entrar' || req.path.startsWith('/auth/') || req.path.startsWith('/css/') || req.path === '/favicon.svg') return next();
    const user = userFromRequest(req);
    if (user) {
      req.user = user;
      return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Faça login para continuar.', login: '/entrar' });
    if (req.method === 'GET' && req.accepts('html')) return res.redirect(`/entrar?volta=${encodeURIComponent(req.originalUrl)}`);
    res.status(401).send('Faça login para continuar.');
  }

  /** Perfil mínimo para a rota (sem login individual configurado, todos podem tudo). */
  const allows = (req, role) => !enabled || (req.user && rank(req.user.role) >= rank(role));

  return { enabled, providers: providers.map(({ id, label }) => ({ id, label })), routes, requireUser, allows, users, createSession, userFromRequest };
}
