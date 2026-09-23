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
      kind           TEXT NOT NULL CHECK (kind IN ('article', 'file')),
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

  return db;
}

const ITEM_COLUMNS = `
  i.id, i.kind, i.title, i.summary, i.tags, i.category_id, i.author,
  i.file_name, i.mime_type, i.size, i.extract_status, i.created_at, i.updated_at,
  c.name AS category_name
`;

function toItem(row) {
  if (!row) return null;
  return { ...row, tags: splitTags(row.tags) };
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
 * Turns free text typed by a person (or by the Active IA) into a safe FTS5
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
      [row.kind === 'article' ? row.content : row.text, row.file_name || ''].join('\n'),
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

    listItems({ categoryId, kind, limit = 50, offset = 0 } = {}) {
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
      const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const rows = db
        .prepare(
          `SELECT ${ITEM_COLUMNS}
             FROM items i LEFT JOIN categories c ON c.id = i.category_id
             ${whereSql}
            ORDER BY i.updated_at DESC, i.id DESC
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
                              file_name, stored_name, mime_type, size, text, extract_status)
           VALUES (@kind, @title, @summary, @content, @tags, @category_id, @author,
                   @file_name, @stored_name, @mime_type, @size, @text, @extract_status)`,
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
        });
      syncFts(info.lastInsertRowid);
      return repo.getItem(info.lastInsertRowid);
    },

    updateItem(id, data) {
      const current = repo.getItem(id, { full: true });
      if (!current) return null;
      db.prepare(
        `UPDATE items SET title = ?, summary = ?, content = ?, tags = ?, category_id = ?,
                          author = ?, updated_at = datetime('now')
          WHERE id = ?`,
      ).run(
        (data.title ?? current.title).trim(),
        (data.summary ?? current.summary).trim(),
        current.kind === 'article' ? (data.content ?? current.content) : current.content,
        joinTags(data.tags ?? current.tags),
        data.category_id === undefined ? current.category_id : data.category_id || null,
        (data.author ?? current.author).trim(),
        id,
      );
      syncFts(id);
      return repo.getItem(id);
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
      return {
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
