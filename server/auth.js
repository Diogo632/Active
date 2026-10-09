import crypto from 'node:crypto';
import express from 'express';

/**
 * Login próprio da plataforma: cada pessoa tem e-mail e senha, criados por um administrador.
 * Perfis: "leitor" (consulta e usa a Active AI), "editor" (também cria e edita documentos) e
 * "admin" (também gerencia as pessoas). Senhas guardadas com scrypt; sessões em cookie HttpOnly,
 * guardadas no banco só como hash.
 */

export const ROLES = ['leitor', 'editor', 'admin'];
export const MIN_PASSWORD = 10;
const rank = (role) => ROLES.indexOf(role);
const COOKIE = 'kb_sessao';

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const normEmail = (v) => String(v || '').trim().toLowerCase().slice(0, 200);
const validEmail = (v) => /^[^\s@]+@[^\s@]+$/.test(v);

// ---------- Senhas ----------
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, hash] = String(stored || '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const given = crypto.scryptSync(String(password), Buffer.from(salt, 'base64'), expected.length, { N: Number(N), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(given, expected);
}

// Usado quando o e-mail não existe, para a resposta demorar o mesmo tempo (não revela quem tem conta).
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString('hex'));

/** Senha provisória fácil de ditar: 3 grupos de 4 letras/números (sem 0/O, 1/l/I). */
export function temporaryPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(12);
  const s = [...bytes].map((b) => chars[b % chars.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** Motivo para recusar uma senha nova, ou '' se ela serve. */
export function passwordProblem(password, { email = '', name = '' } = {}) {
  const p = String(password || '');
  if (p.length < MIN_PASSWORD) return `A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`;
  if (p.length > 200) return 'A senha é longa demais.';
  const lower = p.toLowerCase();
  if (email && lower.includes(email.split('@')[0].toLowerCase()) && email.split('@')[0].length >= 4) return 'A senha não pode conter o seu e-mail.';
  if (/^(.)\1+$/.test(p) || ['1234567890', 'senha12345', 'password12', 'qwertyuiop'].some((w) => lower.includes(w))) return 'Escolha uma senha menos óbvia.';
  if (name && name.length >= 4 && lower.includes(name.toLowerCase())) return 'A senha não pode ser o seu nome.';
  return '';
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* cookie malformado: ignora */
      }
    }
  }
  return out;
}

// ---------- Pessoas (banco) ----------
export function createUsers(db) {
  const COLUMNS = 'id, email, name, role, active, must_change_password, created_at, last_login_at';
  const users = {
    count: () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    list: () => db.prepare(`SELECT ${COLUMNS} FROM users ORDER BY name COLLATE NOCASE, email`).all(),
    get: (id) => db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id),
    byEmail: (email) => db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(email)),

    /** Cria a pessoa. Sem `password`, gera uma senha provisória (trocada no primeiro login). */
    create({ name, email, role = 'editor', password }) {
      email = normEmail(email);
      name = String(name || '').trim().slice(0, 120);
      if (!name) throw Object.assign(new Error('Informe o nome.'), { status: 400 });
      if (!validEmail(email)) throw Object.assign(new Error('Informe um e-mail válido.'), { status: 400 });
      if (!ROLES.includes(role)) throw Object.assign(new Error('Perfil inválido.'), { status: 400 });
      if (users.byEmail(email)) throw Object.assign(new Error('Já existe uma pessoa com este e-mail.'), { status: 409 });
      const temporary = !password;
      const secret = password || temporaryPassword();
      const id = db
        .prepare("INSERT INTO users (email, name, provider, role, password_hash, must_change_password) VALUES (?, ?, 'local', ?, ?, ?)")
        .run(email, name, role, hashPassword(secret), temporary ? 1 : 0).lastInsertRowid;
      return { user: users.get(id), password: temporary ? secret : undefined };
    },

    update(id, { name, email, role, active }) {
      const current = users.get(id);
      if (!current) return null;
      const next = {
        name: name === undefined ? current.name : String(name).trim().slice(0, 120) || current.name,
        email: email === undefined ? current.email : normEmail(email),
        role: ROLES.includes(role) ? role : current.role,
        active: active === undefined ? current.active : active ? 1 : 0,
      };
      if (!validEmail(next.email)) throw Object.assign(new Error('Informe um e-mail válido.'), { status: 400 });
      const other = users.byEmail(next.email);
      if (other && other.id !== id) throw Object.assign(new Error('Já existe uma pessoa com este e-mail.'), { status: 409 });
      db.prepare('UPDATE users SET name = ?, email = ?, role = ?, active = ? WHERE id = ?').run(next.name, next.email, next.role, next.active, id);
      if (!next.active) users.endSessions(id);
      return users.get(id);
    },

    /** Nova senha provisória (o administrador repassa; a pessoa troca no próximo login). */
    resetPassword(id) {
      if (!users.get(id)) return null;
      const password = temporaryPassword();
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(password), id);
      users.endSessions(id);
      return password;
    },

    setPassword(id, password, { keepSession } = {}) {
      db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(password), id);
      // Trocar a senha desconecta os outros aparelhos.
      if (keepSession) db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(id, keepSession);
      else users.endSessions(id);
    },

    remove: (id) => db.prepare('DELETE FROM users WHERE id = ?').run(id).changes > 0,
    endSessions: (id) => db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id),
    admins: () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").get().n,
  };
  return users;
}

// ---------- Login, sessões e páginas ----------
export function createAuth({ db, enabled = true, publicUrl = process.env.PUBLIC_URL || '', env = process.env, failures, log = console }) {
  const sessionDays = Math.max(1, Number(env.SESSION_DAYS) || 30);
  const users = createUsers(db);

  const isHttps = (req) => req.secure || String(publicUrl).startsWith('https://');
  const safeReturn = (v) => (typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\') ? v : '/');
  const cookie = (req, value, maxAgeSeconds) =>
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${isHttps(req) ? '; Secure' : ''}`;

  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`).run(sha256(token), userId, `+${sessionDays} days`);
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
    db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
    return token;
  }

  function userFromRequest(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (!token) return null;
    const row = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.active, u.must_change_password, s.expires_at, s.token_hash FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > datetime('now')`,
      )
      .get(sha256(token));
    if (!row || !row.active) return null;
    // Renova a sessão quando passa da metade do prazo (quem usa todo dia não precisa entrar de novo).
    const remainingDays = (Date.parse(`${row.expires_at.replace(' ', 'T')}Z`) - Date.now()) / 86_400_000;
    if (remainingDays < sessionDays / 2) {
      db.prepare(`UPDATE sessions SET expires_at = datetime('now', ?) WHERE token_hash = ?`).run(`+${sessionDays} days`, row.token_hash);
    }
    return { id: row.id, email: row.email, name: row.name, role: row.role, mustChangePassword: Boolean(row.must_change_password), sessionHash: row.token_hash };
  }

  // Páginas de login renderizadas no servidor (sem JavaScript: funcionam com a política de conteúdo).
  const page = (title, body) => `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · Base de Conhecimento Active</title><link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="stylesheet" href="/css/styles.css" /></head>
<body class="login-body"><main class="login-card">
  <span class="brand-mark" aria-hidden="true">A</span>
  ${body}
</main><script src="/js/login.js" defer></script></body></html>`;
  const errorBox = (message) => (message ? `<div class="msg-error" role="alert">${esc(message)}</div>` : '');
  const field = (label, attrs) => `<label class="login-field"><span>${esc(label)}</span><input class="input" ${attrs} /></label>`;

  const ERRORS = {
    senha: 'E-mail ou senha incorretos.',
    bloqueado: 'Muitas tentativas erradas. Aguarde alguns minutos e tente de novo.',
    origem: 'Pedido recusado: ele veio de outro site.',
  };

  const loginPage = (req, message = '') =>
    page(
      'Entrar',
      `<h1>Base de Conhecimento</h1>
  <p class="muted">Suporte · Active Corp</p>
  ${errorBox(message)}
  <form class="login-form" method="post" action="/entrar">
    <input type="hidden" name="volta" value="${esc(safeReturn(req.query.volta || req.body?.volta))}" />
    ${field('E-mail', `type="email" name="email" autocomplete="username" required autofocus value="${esc(req.body?.email || '')}"`)}
    ${field('Senha', 'type="password" name="senha" autocomplete="current-password" required')}
    <button class="btn btn-primary btn-block" type="submit">Entrar</button>
  </form>
  <p class="muted small">Esqueceu a senha ou ainda não tem acesso? Fale com um administrador da plataforma.</p>`,
    );

  const setupPage = (req, message = '') =>
    page(
      'Primeiro acesso',
      `<h1>Primeiro acesso</h1>
  <p class="muted">Crie a conta de administrador. Depois, você cadastra a equipe em <strong>Pessoas</strong>.</p>
  ${errorBox(message)}
  <form class="login-form" method="post" action="/primeiro-acesso">
    ${field('Seu nome', `name="nome" autocomplete="name" required autofocus maxlength="120" value="${esc(req.body?.nome || '')}"`)}
    ${field('E-mail', `type="email" name="email" autocomplete="username" required value="${esc(req.body?.email || '')}"`)}
    ${field(`Senha (mínimo ${MIN_PASSWORD} caracteres)`, `type="password" name="senha" autocomplete="new-password" required minlength="${MIN_PASSWORD}"`)}
    ${field('Repita a senha', `type="password" name="confirmacao" autocomplete="new-password" required minlength="${MIN_PASSWORD}"`)}
    <button class="btn btn-primary btn-block" type="submit">Criar administrador e entrar</button>
  </form>`,
    );

  const changePage = (req, user, message = '') =>
    page(
      'Trocar senha',
      `<h1>${user.mustChangePassword ? 'Crie a sua senha' : 'Trocar senha'}</h1>
  <p class="muted">${user.mustChangePassword ? `Olá, ${esc(user.name)}! Você entrou com uma senha provisória. Escolha a sua senha para continuar.` : esc(user.email)}</p>
  ${errorBox(message)}
  <form class="login-form" method="post" action="/trocar-senha">
    <input type="hidden" name="volta" value="${esc(safeReturn(req.query.volta || req.body?.volta))}" />
    <input type="email" name="email" autocomplete="username" value="${esc(user.email)}" hidden />
    ${user.mustChangePassword ? '' : field('Senha atual', 'type="password" name="atual" autocomplete="current-password" required')}
    ${field(`Nova senha (mínimo ${MIN_PASSWORD} caracteres)`, `type="password" name="senha" autocomplete="new-password" required minlength="${MIN_PASSWORD}" ${user.mustChangePassword ? 'autofocus' : ''}`)}
    ${field('Repita a nova senha', `type="password" name="confirmacao" autocomplete="new-password" required minlength="${MIN_PASSWORD}"`)}
    <button class="btn btn-primary btn-block" type="submit">Salvar senha</button>
  </form>
  ${user.mustChangePassword ? '' : '<p class="small"><a href="/">← Voltar para a plataforma</a></p>'}`,
    );

  const send = (res, html, status = 200) => res.status(status).set('Cache-Control', 'no-store').type('html').send(html);
  // Formulários de login só valem vindos da própria plataforma (impede login forçado por outro site).
  const crossSite = (req) => {
    const site = req.headers['sec-fetch-site'];
    return Boolean(site && site !== 'same-origin' && site !== 'none');
  };

  function routes(app) {
    const form = express.urlencoded({ extended: false, limit: '10kb' });

    app.get('/entrar', (req, res) => {
      if (users.count() === 0) return send(res, setupPage(req));
      if (userFromRequest(req)) return res.redirect(safeReturn(req.query.volta));
      send(res, loginPage(req, ERRORS[req.query.erro] || ''));
    });

    app.post('/entrar', form, (req, res) => {
      if (crossSite(req)) return send(res, loginPage(req, ERRORS.origem), 403);
      if (failures?.isBlocked(req)) return send(res, loginPage(req, ERRORS.bloqueado), 429);
      const email = normEmail(req.body?.email);
      const password = String(req.body?.senha || '');
      const row = email ? users.byEmail(email) : null;
      const ok = verifyPassword(password, row?.password_hash || DUMMY_HASH) && row && row.active;
      if (!ok) {
        failures?.fail(req);
        log.log(`[login] Falha ao entrar: ${email || '(sem e-mail)'}${row && !row.active ? ' (acesso bloqueado)' : ''}`);
        return send(res, loginPage(req, row && !row.active && verifyPassword(password, row.password_hash) ? 'Seu acesso está bloqueado. Fale com um administrador.' : ERRORS.senha), 401);
      }
      const token = createSession(row.id);
      log.log(`[login] ${row.email} entrou (perfil ${row.role})`);
      res.set('Set-Cookie', cookie(req, token, sessionDays * 86400));
      const volta = safeReturn(req.body?.volta);
      res.redirect(303, row.must_change_password ? `/trocar-senha?volta=${encodeURIComponent(volta)}` : volta);
    });

    app.post('/primeiro-acesso', form, (req, res) => {
      if (users.count() > 0) return res.redirect(303, '/entrar');
      if (crossSite(req)) return send(res, setupPage(req, ERRORS.origem), 403);
      const { nome, email, senha, confirmacao } = req.body || {};
      const problem = senha !== confirmacao ? 'As senhas não são iguais.' : passwordProblem(senha, { email: normEmail(email), name: nome });
      if (problem) return send(res, setupPage(req, problem), 400);
      try {
        const { user } = users.create({ name: nome, email, role: 'admin', password: senha });
        log.log(`[login] Administrador criado no primeiro acesso: ${user.email}`);
        res.set('Set-Cookie', cookie(req, createSession(user.id), sessionDays * 86400));
        res.redirect(303, '/');
      } catch (err) {
        send(res, setupPage(req, err.message), err.status || 400);
      }
    });

    app.get('/trocar-senha', (req, res) => {
      const user = userFromRequest(req);
      if (!user) return res.redirect('/entrar');
      send(res, changePage(req, user));
    });

    app.post('/trocar-senha', form, (req, res) => {
      const user = userFromRequest(req);
      if (!user) return res.redirect(303, '/entrar');
      if (crossSite(req)) return send(res, changePage(req, user, ERRORS.origem), 403);
      if (failures?.isBlocked(req)) return send(res, changePage(req, user, ERRORS.bloqueado), 429);
      const { atual, senha, confirmacao } = req.body || {};
      if (!user.mustChangePassword) {
        const row = users.byEmail(user.email);
        if (!verifyPassword(String(atual || ''), row.password_hash)) {
          failures?.fail(req);
          return send(res, changePage(req, user, 'A senha atual está incorreta.'), 400);
        }
        if (atual === senha) return send(res, changePage(req, user, 'A nova senha precisa ser diferente da atual.'), 400);
      }
      const problem = senha !== confirmacao ? 'As senhas não são iguais.' : passwordProblem(senha, user);
      if (problem) return send(res, changePage(req, user, problem), 400);
      users.setPassword(user.id, senha, { keepSession: user.sessionHash });
      log.log(`[login] ${user.email} trocou a senha`);
      res.redirect(303, safeReturn(req.body?.volta));
    });

    app.post('/auth/sair', (req, res) => {
      const token = parseCookies(req.headers.cookie)[COOKIE];
      if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
      res.set('Set-Cookie', cookie(req, '', 0));
      res.json({ ok: true, login: '/entrar' });
    });
  }

  /** Exige login em tudo, exceto as páginas de login e os arquivos delas. */
  const OPEN = new Set(['/entrar', '/primeiro-acesso', '/favicon.svg', '/js/login.js']);
  function requireUser(req, res, next) {
    if (OPEN.has(req.path) || req.path.startsWith('/css/')) return next();
    const user = userFromRequest(req);
    if (user?.mustChangePassword && req.path !== '/trocar-senha' && req.path !== '/auth/sair') {
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Crie a sua senha para continuar.', login: '/trocar-senha' });
      return res.redirect('/trocar-senha');
    }
    if (user) {
      req.user = user;
      return next();
    }
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Faça login para continuar.', login: '/entrar' });
    if (req.method === 'GET' && req.accepts('html')) return res.redirect(`/entrar?volta=${encodeURIComponent(req.originalUrl)}`);
    res.status(401).send('Faça login para continuar.');
  }

  /** Perfil mínimo para a rota (com o login desligado, todos podem tudo). */
  const allows = (req, role) => !enabled || (req.user && rank(req.user.role) >= rank(role));

  return { enabled, routes, requireUser, allows, users, createSession, userFromRequest };
}
