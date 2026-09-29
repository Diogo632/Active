import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'base.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      icon        TEXT NOT NULL DEFAULT 'folder',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS items (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      kind           TEXT NOT NULL CHECK (kind IN ('article', 'file', 'youtube')),
      title          TEXT NOT NULL,
      summary        TEXT NOT NULL DEFAULT '',
      content        TEXT NOT NULL DEFAULT '',
      tags           TEXT NOT NULL DEFAULT '',
      category_id    INTEGER REFERENCES categories(id) ON DELETE SET NULL,
      author         TEXT NOT NULL DEFAULT '',
      file_name      TEXT,
      stored_name    TEXT,
      mime_type      TEXT,
      size           INTEGER,
      text           TEXT NOT NULL DEFAULT '',
      extract_status TEXT NOT NULL DEFAULT 'ok',
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS items_category ON items(category_id);
    CREATE INDEX IF NOT EXISTS items_updated ON items(updated_at);

    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
      title, tags, summary, body,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `);

  // Migração: contador de acessos (bancos criados antes desta coluna existir).
  const columns = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  if (!columns.includes('views')) db.exec('ALTER TABLE items ADD COLUMN views INTEGER NOT NULL DEFAULT 0');
  // Vídeos e áudios: estado da transcrição (pendente, processando, concluida, manual, erro, indisponivel).
  if (!columns.includes('media_status')) {
    db.exec(`
      ALTER TABLE items ADD COLUMN media_status TEXT;
      ALTER TABLE items ADD COLUMN media_progress INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE items ADD COLUMN media_error TEXT;
      ALTER TABLE items ADD COLUMN duration REAL;
    `);
  }

  // Colunas novas: vídeos do YouTube, data de revisão e capítulos gerados pela Active AI.
  const NEW_COLUMNS = {
    source_url: 'TEXT',
    review_months: 'INTEGER',
    reviewed_at: 'TEXT',
    ai_summary: 'TEXT',
    chapters: 'TEXT',
    chapters_status: 'TEXT',
    chapters_error: 'TEXT',
  };
  const present = db.prepare('PRAGMA table_info(items)').all().map((c) => c.name);
  for (const [name, type] of Object.entries(NEW_COLUMNS)) {
    if (!present.includes(name)) db.exec(`ALTER TABLE items ADD COLUMN ${name} ${type}`);
  }

  // Bancos antigos só aceitavam os tipos 'article' e 'file': recria a tabela aceitando 'youtube'.
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'").get();
  if (!sql.includes("'youtube'")) {
    db.pragma('foreign_keys = OFF');
    db.transaction(() => {
      db.exec(sql.replace(/CREATE TABLE "?items"?/, 'CREATE TABLE items_new').replace("('article', 'file')", "('article', 'file', 'youtube')"));
      db.exec('INSERT INTO items_new SELECT * FROM items');
      db.exec('DROP TABLE items');
      db.exec('ALTER TABLE items_new RENAME TO items');
      db.exec('CREATE INDEX IF NOT EXISTS items_category ON items(category_id); CREATE INDEX IF NOT EXISTS items_updated ON items(updated_at);');
    })();
    db.pragma('foreign_keys = ON');
  }

  db.exec(`
    -- Versões anteriores dos textos (cada edição guarda como o texto estava antes).
    CREATE TABLE IF NOT EXISTS item_versions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id     INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      title       TEXT NOT NULL,
      summary     TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      tags        TEXT NOT NULL DEFAULT '',
      category_id INTEGER,
      author      TEXT NOT NULL DEFAULT '',
      saved_at    TEXT NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS item_versions_item ON item_versions(item_id);

    -- Lacunas: buscas sem resultado, perguntas que a Active AI não soube responder e avisos do agente.
    CREATE TABLE IF NOT EXISTS gaps (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      source           TEXT NOT NULL,
      query            TEXT NOT NULL,
      normalized       TEXT NOT NULL,
      detail           TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at      TEXT,
      resolved_item_id INTEGER REFERENCES items(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS gaps_normalized ON gaps(normalized);

    -- Avaliações "Isso ajudou?" de documentos e de respostas da Active AI.
    CREATE TABLE IF NOT EXISTS feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      target     TEXT NOT NULL CHECK (target IN ('documento', 'resposta')),
      item_id    INTEGER REFERENCES items(id) ON DELETE CASCADE,
      helpful    INTEGER NOT NULL,
      comment    TEXT NOT NULL DEFAULT '',
      question   TEXT NOT NULL DEFAULT '',
      answer     TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS feedback_item ON feedback(item_id);
  `);

  return db;
}

/** Texto normalizado para agrupar lacunas iguais ("Emitir CT-e?" = "emitir ct e"). */
export function normalizeQuery(text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 300);
}

/** Estados de transcrição em que o texto já está pronto. */
export const TRANSCRIPT_READY = ['concluida', 'manual', 'legendas'];

const ITEM_COLUMNS = `
  i.id, i.kind, i.title, i.summary, i.tags, i.category_id, i.author,
  i.file_name, i.mime_type, i.size, i.extract_status, i.views, i.created_at, i.updated_at,
  i.media_status, i.media_progress, i.media_error, i.duration,
  i.source_url, i.review_months, i.reviewed_at, i.ai_summary, i.chapters, i.chapters_status, i.chapters_error,
  CASE WHEN i.review_months > 0
       THEN date(max(COALESCE(i.reviewed_at, ''), i.updated_at), '+' || i.review_months || ' months') END AS review_due,
  c.name AS category_name
`;

function toItem(row) {
  if (!row) return null;
  let chapters = [];
  try {
    chapters = row.chapters ? JSON.parse(row.chapters) : [];
  } catch {
    /* capítulos inválidos: ignora */
  }
  const today = new Date().toISOString().slice(0, 10);
  return { ...row, tags: splitTags(row.tags), chapters, review_overdue: Boolean(row.review_due && row.review_due <= today) };
}

export function splitTags(tags) {
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  return String(tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

function joinTags(tags) {
  return [...new Set(splitTags(tags))].join(', ');
}

/**
 * Turns free text typed by a person (or by the Active AI) into a safe FTS5
 * query: every word becomes a quoted prefix term, so punctuation typed by the
 * user can never break the FTS5 syntax.
 */
export function toFtsQuery(text, mode = 'AND') {
  const words = String(text || '')
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu);
  if (!words) return null;
  return [...new Set(words)]
    .slice(0, 12)
    .map((w) => `"${w}"*`)
    .join(mode === 'OR' ? ' OR ' : ' ');
}

export function createRepository(db) {
  const syncFts = (id) => {
    db.prepare('DELETE FROM items_fts WHERE rowid = ?').run(id);
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!row) return;
    db.prepare('INSERT INTO items_fts (rowid, title, tags, summary, body) VALUES (?, ?, ?, ?, ?)').run(
      id,
      row.title,
      row.tags,
      row.summary,
      [
        row.kind === 'article' ? row.content : row.text,
        row.file_name || '',
        row.ai_summary || '',
        (() => {
          try {
            return (JSON.parse(row.chapters || '[]') || []).map((c) => c.title).join('\n');
          } catch {
            return '';
          }
        })(),
      ].join('\n'),
    );
  };

  const repo = {
    // ---------- Categorias ----------
    listCategories() {
      return db
        .prepare(
          `SELECT c.*, COUNT(i.id) AS item_count
             FROM categories c LEFT JOIN items i ON i.category_id = c.id
            GROUP BY c.id ORDER BY c.name COLLATE NOCASE`,
        )
        .all();
    },

    getCategory(id) {
      return db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    },

    createCategory({ name, description = '', icon = 'folder' }) {
      const info = db
        .prepare('INSERT INTO categories (name, description, icon) VALUES (?, ?, ?)')
        .run(name.trim(), description.trim(), icon);
      return repo.getCategory(info.lastInsertRowid);
    },

    updateCategory(id, { name, description, icon }) {
      const current = repo.getCategory(id);
      if (!current) return null;
      db.prepare('UPDATE categories SET name = ?, description = ?, icon = ? WHERE id = ?').run(
        (name ?? current.name).trim(),
        (description ?? current.description).trim(),
        icon ?? current.icon,
        id,
      );
      return repo.getCategory(id);
    },

    deleteCategory(id) {
      return db.prepare('DELETE FROM categories WHERE id = ?').run(id).changes > 0;
    },

    // ---------- Itens (textos e arquivos) ----------
    getItem(id, { full = false } = {}) {
      const extra = full ? ', i.content, i.text, i.stored_name' : '';
      const row = db
        .prepare(
          `SELECT ${ITEM_COLUMNS}${extra}
             FROM items i LEFT JOIN categories c ON c.id = i.category_id
            WHERE i.id = ?`,
        )
        .get(id);
      return toItem(row);
    },

    listItems({ categoryId, kind, limit = 50, offset = 0, sort, reviewDue = false } = {}) {
      const where = [];
      const params = [];
      if (categoryId === 'none') where.push('i.category_id IS NULL');
      else if (categoryId) {
        where.push('i.category_id = ?');
        params.push(categoryId);
      }
      if (kind) {
        where.push('i.kind = ?');
        params.push(kind);
      }
      if (reviewDue) where.push(`i.review_months > 0 AND date(max(COALESCE(i.reviewed_at, ''), i.updated_at), '+' || i.review_months || ' months') <= date('now')`);
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT ${ITEM_COLUMNS}
             FROM items i LEFT JOIN categories c ON c.id = i.category_id
             ${whereSql}
            ORDER BY ${sort === 'views' ? 'i.views DESC, ' : ''}i.updated_at DESC, i.id DESC
            LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
      const { total } = db.prepare(`SELECT COUNT(*) AS total FROM items i ${whereSql}`).get(...params);
      return { items: rows.map(toItem), total };
    },

    search(text, { categoryId, kind, limit = 20 } = {}) {
      const run = (mode) => {
        const query = toFtsQuery(text, mode);
        if (!query) return [];
        const where = ['items_fts MATCH ?'];
        const params = [query];
        if (categoryId === 'none') where.push('i.category_id IS NULL');
        else if (categoryId) {
          where.push('i.category_id = ?');
          params.push(categoryId);
        }
        if (kind) {
          where.push('i.kind = ?');
          params.push(kind);
        }
        return db
          .prepare(
            `SELECT ${ITEM_COLUMNS},
                    snippet(items_fts, 3, '[[', ']]', ' … ', 24) AS snippet,
                    bm25(items_fts, 10.0, 5.0, 3.0, 1.0) AS score
               FROM items_fts
               JOIN items i ON i.id = items_fts.rowid
               LEFT JOIN categories c ON c.id = i.category_id
              WHERE ${where.join(' AND ')}
              ORDER BY score
              LIMIT ?`,
          )
          .all(...params, limit)
          .map(toItem);
      };
      // Primeiro exige todas as palavras; se nada aparecer, aceita qualquer uma.
      const strict = run('AND');
      return strict.length ? strict : run('OR');
    },

    createItem(data) {
      const info = db
        .prepare(
          `INSERT INTO items (kind, title, summary, content, tags, category_id, author,
                              file_name, stored_name, mime_type, size, text, extract_status, source_url, review_months)
           VALUES (@kind, @title, @summary, @content, @tags, @category_id, @author,
                   @file_name, @stored_name, @mime_type, @size, @text, @extract_status, @source_url, @review_months)`,
        )
        .run({
          kind: data.kind,
          title: data.title.trim(),
          summary: (data.summary || '').trim(),
          content: data.content || '',
          tags: joinTags(data.tags),
          category_id: data.category_id || null,
          author: (data.author || '').trim(),
          file_name: data.file_name || null,
          stored_name: data.stored_name || null,
          mime_type: data.mime_type || null,
          size: data.size ?? null,
          text: data.text || '',
          extract_status: data.extract_status || 'ok',
          source_url: data.source_url || null,
          review_months: data.review_months > 0 ? Math.round(data.review_months) : null,
        });
      syncFts(info.lastInsertRowid);
      return repo.getItem(info.lastInsertRowid);
    },

    updateItem(id, data) {
      const current = repo.getItem(id, { full: true });
      if (!current) return null;
      const next = {
        title: (data.title ?? current.title).trim(),
        summary: (data.summary ?? current.summary).trim(),
        content: current.kind === 'article' ? (data.content ?? current.content) : current.content,
        tags: joinTags(data.tags ?? current.tags),
        category_id: data.category_id === undefined ? current.category_id : data.category_id || null,
        author: (data.author ?? current.author).trim(),
      };
      const reviewMonths =
        data.review_months === undefined ? current.review_months : Number(data.review_months) > 0 ? Math.round(Number(data.review_months)) : null;
      // Guarda como o texto estava antes, se o conteúdo mudou (histórico de versões).
      const changed =
        current.kind === 'article' &&
        (next.title !== current.title || next.content !== current.content || next.summary !== current.summary || next.tags !== joinTags(current.tags));
      const run = db.transaction(() => {
        if (changed) {
          db.prepare(
            `INSERT INTO item_versions (item_id, title, summary, content, tags, category_id, author, saved_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(id, current.title, current.summary, current.content, joinTags(current.tags), current.category_id, current.author, current.updated_at);
        }
        db.prepare(
          `UPDATE items SET title = ?, summary = ?, content = ?, tags = ?, category_id = ?,
                            author = ?, review_months = ?, updated_at = datetime('now')
            WHERE id = ?`,
        ).run(next.title, next.summary, next.content, next.tags, next.category_id, next.author, reviewMonths, id);
      });
      run();
      syncFts(id);
      return repo.getItem(id);
    },

    // ---------- Histórico de versões ----------
    listVersions(itemId) {
      return db
        .prepare(
          `SELECT id, item_id, title, author, saved_at, length(content) AS size
             FROM item_versions WHERE item_id = ? ORDER BY saved_at DESC, id DESC`,
        )
        .all(itemId);
    },

    getVersion(itemId, versionId) {
      const row = db.prepare('SELECT * FROM item_versions WHERE id = ? AND item_id = ?').get(versionId, itemId);
      return row ? { ...row, tags: splitTags(row.tags) } : null;
    },

    /** Volta o texto a uma versão anterior (a versão atual também entra no histórico). */
    restoreVersion(itemId, versionId, author) {
      const version = repo.getVersion(itemId, versionId);
      if (!version) return null;
      return repo.updateItem(itemId, {
        title: version.title,
        summary: version.summary,
        content: version.content,
        tags: version.tags,
        author: author ?? version.author,
      });
    },

    // ---------- Revisão ----------
    markReviewed(id) {
      db.prepare("UPDATE items SET reviewed_at = datetime('now') WHERE id = ?").run(id);
      return repo.getItem(id);
    },

    // ---------- Capítulos (resumo e índice gerados pela Active AI) ----------
    setChapters(id, { status, summary, chapters, error } = {}) {
      const sets = [];
      const params = [];
      if (status !== undefined) sets.push('chapters_status = ?') && params.push(status);
      if (summary !== undefined) sets.push('ai_summary = ?') && params.push(summary);
      if (chapters !== undefined) sets.push('chapters = ?') && params.push(JSON.stringify(chapters));
      if (error !== undefined) sets.push('chapters_error = ?') && params.push(error);
      if (!sets.length) return;
      db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
      if (summary !== undefined || chapters !== undefined) syncFts(id);
    },

    findBySourceUrl(url) {
      const row = db.prepare('SELECT id FROM items WHERE source_url = ?').get(url);
      return row ? repo.getItem(row.id) : null;
    },

    // ---------- Lacunas ----------
    /** Registra uma lacuna; repetições da mesma pergunta e origem em 10 minutos contam uma vez só. */
    addGap({ source, query, detail = '' }) {
      const text = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const normalized = normalizeQuery(text);
      if (!normalized) return null;
      const recent = db
        .prepare(
          `SELECT id FROM gaps WHERE normalized = ? AND source = ? AND resolved_at IS NULL
              AND created_at >= datetime('now', '-10 minutes')`,
        )
        .get(normalized, source);
      if (recent) {
        if (detail) db.prepare('UPDATE gaps SET detail = ? WHERE id = ?').run(String(detail).slice(0, 2000), recent.id);
        return recent.id;
      }
      return db
        .prepare('INSERT INTO gaps (source, query, normalized, detail) VALUES (?, ?, ?, ?)')
        .run(source, text, normalized, String(detail || '').slice(0, 2000)).lastInsertRowid;
    },

    /** Lacunas agrupadas pela pergunta normalizada, das mais frequentes para as menos. */
    listGaps({ resolved = false, limit = 200 } = {}) {
      const rows = db
        .prepare(
          `SELECT normalized, COUNT(*) AS count, MAX(created_at) AS last_at, MIN(created_at) AS first_at,
                  group_concat(DISTINCT source) AS sources,
                  (SELECT g2.query FROM gaps g2 WHERE g2.normalized = g.normalized ORDER BY g2.id DESC LIMIT 1) AS query,
                  MAX(resolved_at) AS resolved_at,
                  (SELECT g3.resolved_item_id FROM gaps g3 WHERE g3.normalized = g.normalized AND g3.resolved_item_id IS NOT NULL
                    ORDER BY g3.id DESC LIMIT 1) AS resolved_item_id
             FROM gaps g
            WHERE ${resolved ? 'resolved_at IS NOT NULL' : 'resolved_at IS NULL'}
            GROUP BY normalized
            ORDER BY count DESC, last_at DESC
            LIMIT ?`,
        )
        .all(limit);
      const details = db.prepare(
        `SELECT source, detail, created_at FROM gaps
          WHERE normalized = ? AND detail <> '' ORDER BY id DESC LIMIT 5`,
      );
      return rows.map((r) => ({ ...r, sources: r.sources.split(','), details: details.all(r.normalized) }));
    },

    resolveGap(normalized, itemId = null) {
      return db
        .prepare("UPDATE gaps SET resolved_at = datetime('now'), resolved_item_id = ? WHERE normalized = ? AND resolved_at IS NULL")
        .run(itemId, normalizeQuery(normalized)).changes;
    },

    reopenGap(normalized) {
      return db.prepare('UPDATE gaps SET resolved_at = NULL, resolved_item_id = NULL WHERE normalized = ?').run(normalizeQuery(normalized)).changes;
    },

    // ---------- Avaliações ----------
    addFeedback({ target, item_id = null, helpful, comment = '', question = '', answer = '' }) {
      const info = db
        .prepare('INSERT INTO feedback (target, item_id, helpful, comment, question, answer) VALUES (?, ?, ?, ?, ?, ?)')
        .run(target, item_id, helpful ? 1 : 0, String(comment).slice(0, 2000), String(question).slice(0, 2000), String(answer).slice(0, 20000));
      return info.lastInsertRowid;
    },

    feedbackFor(itemId) {
      const row = db
        .prepare("SELECT SUM(helpful = 1) AS up, SUM(helpful = 0) AS down FROM feedback WHERE target = 'documento' AND item_id = ?")
        .get(itemId);
      return { up: row.up || 0, down: row.down || 0 };
    },

    feedbackReport() {
      const totals = db
        .prepare('SELECT target, SUM(helpful = 1) AS up, SUM(helpful = 0) AS down FROM feedback GROUP BY target')
        .all()
        .reduce((acc, r) => ({ ...acc, [r.target]: { up: r.up || 0, down: r.down || 0 } }), {});
      const docs = db
        .prepare(
          `SELECT f.item_id AS id, i.title, SUM(f.helpful = 1) AS up, SUM(f.helpful = 0) AS down,
                  (SELECT group_concat(f2.comment, '\u001f') FROM (SELECT comment FROM feedback
                     WHERE target = 'documento' AND item_id = f.item_id AND helpful = 0 AND comment <> '' ORDER BY id DESC LIMIT 5) f2) AS comments
             FROM feedback f JOIN items i ON i.id = f.item_id
            WHERE f.target = 'documento'
            GROUP BY f.item_id
           HAVING down > 0
            ORDER BY down DESC, up ASC
            LIMIT 50`,
        )
        .all()
        .map((r) => ({ ...r, comments: r.comments ? r.comments.split('\u001f') : [] }));
      const answers = db
        .prepare(
          `SELECT id, question, answer, comment, created_at FROM feedback
            WHERE target = 'resposta' AND helpful = 0 ORDER BY id DESC LIMIT 50`,
        )
        .all();
      return {
        totals: { documento: totals.documento || { up: 0, down: 0 }, resposta: totals.resposta || { up: 0, down: 0 } },
        docs,
        answers,
      };
    },

    replaceFile(id, file) {
      db.prepare(
        `UPDATE items SET file_name = ?, stored_name = ?, mime_type = ?, size = ?, text = ?,
                          extract_status = ?, updated_at = datetime('now')
          WHERE id = ?`,
      ).run(file.file_name, file.stored_name, file.mime_type, file.size, file.text, file.extract_status, id);
      syncFts(id);
      return repo.getItem(id);
    },

    /** Atualiza o estado da transcrição de um vídeo/áudio. */
    setMedia(id, { status, progress, error, duration } = {}) {
      const sets = [];
      const params = [];
      if (status !== undefined) sets.push('media_status = ?') && params.push(status);
      if (progress !== undefined) sets.push('media_progress = ?') && params.push(Math.round(progress));
      if (error !== undefined) sets.push('media_error = ?') && params.push(error);
      if (duration !== undefined) sets.push('duration = ?') && params.push(duration);
      if (!sets.length) return;
      db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
    },

    /** Grava a transcrição como conteúdo pesquisável do item. */
    setTranscript(id, text, status = 'concluida') {
      db.prepare(
        `UPDATE items SET text = ?, extract_status = ?, media_status = ?, media_progress = 100, media_error = NULL,
                          updated_at = datetime('now') WHERE id = ?`,
      ).run(text, text ? 'ok' : 'empty', status, id);
      // Transcrição nova: capítulos antigos deixam de valer.
      db.prepare('UPDATE items SET chapters = NULL, ai_summary = NULL, chapters_status = NULL, chapters_error = NULL WHERE id = ?').run(id);
      syncFts(id);
    },

    /** Itens com transcrição a fazer (usado para retomar a fila quando o servidor reinicia). */
    pendingTranscriptions() {
      return db
        .prepare("SELECT id FROM items WHERE media_status IN ('pendente', 'processando') ORDER BY id")
        .all()
        .map((r) => r.id);
    },

    registerView(id) {
      db.prepare('UPDATE items SET views = views + 1 WHERE id = ?').run(id);
    },

    deleteItem(id) {
      const item = repo.getItem(id, { full: true });
      if (!item) return null;
      db.prepare('DELETE FROM items WHERE id = ?').run(id);
      db.prepare('DELETE FROM items_fts WHERE rowid = ?').run(id);
      return item;
    },

    allTags() {
      const counts = new Map();
      for (const { tags } of db.prepare("SELECT tags FROM items WHERE tags <> ''").all()) {
        for (const tag of splitTags(tags)) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
      return [...counts.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    },

    stats() {
      const row = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(kind = 'article') AS articles,
                  SUM(kind = 'file') AS files,
                  COALESCE(SUM(size), 0) AS bytes
             FROM items`,
        )
        .get();
      const { categories } = db.prepare('SELECT COUNT(*) AS categories FROM categories').get();
      const { gaps } = db.prepare('SELECT COUNT(DISTINCT normalized) AS gaps FROM gaps WHERE resolved_at IS NULL').get();
      const { review } = db
        .prepare(
          `SELECT COUNT(*) AS review FROM items i WHERE i.review_months > 0
              AND date(max(COALESCE(i.reviewed_at, ''), i.updated_at), '+' || i.review_months || ' months') <= date('now')`,
        )
        .get();
      return {
        gaps_open: gaps,
        review_due: review,
        total: row.total,
        articles: row.articles || 0,
        files: row.files || 0,
        bytes: row.bytes,
        categories,
      };
    },
  };

  return repo;
}
