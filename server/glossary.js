import { normalizeQuery } from './db.js';

const splitList = (text) =>
  String(text || '')
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * Glossário da Active: termos internos, siglas e sinônimos (ex.: "CT-e" = "conhecimento de transporte").
 * Usado para ampliar a busca (busca também pelos sinônimos) e para explicar os termos à Active AI.
 */
export function createGlossary(db) {
  const toEntry = (row) => (row ? { ...row, synonyms: splitList(row.synonyms) } : null);

  // Cache das formas normalizadas, refeito quando o glossário muda.
  let cache = null;
  const entries = () => {
    if (!cache) {
      cache = db
        .prepare('SELECT * FROM glossary_terms ORDER BY term COLLATE NOCASE')
        .all()
        .map(toEntry)
        .map((e) => ({ ...e, aliases: [e.term, ...e.synonyms].map((a) => ({ text: a, norm: normalizeQuery(a) })).filter((a) => a.norm) }));
    }
    return cache;
  };
  const invalidate = () => {
    cache = null;
  };

  const clean = ({ term, synonyms, description }) => ({
    term: String(term || '').trim().slice(0, 120),
    synonyms: splitList(Array.isArray(synonyms) ? synonyms.join(',') : synonyms)
      .map((s) => s.slice(0, 120))
      .slice(0, 30)
      .join(', '),
    description: String(description || '').trim().slice(0, 1000),
  });

  const glossary = {
    list() {
      return entries().map(({ aliases, ...e }) => e);
    },

    get(id) {
      return toEntry(db.prepare('SELECT * FROM glossary_terms WHERE id = ?').get(id));
    },

    create(data) {
      const e = clean(data);
      const id = db.prepare('INSERT INTO glossary_terms (term, synonyms, description) VALUES (?, ?, ?)').run(e.term, e.synonyms, e.description).lastInsertRowid;
      invalidate();
      return glossary.get(id);
    },

    update(id, data) {
      const current = glossary.get(id);
      if (!current) return null;
      const e = clean({ term: data.term ?? current.term, synonyms: data.synonyms ?? current.synonyms, description: data.description ?? current.description });
      db.prepare("UPDATE glossary_terms SET term = ?, synonyms = ?, description = ?, updated_at = datetime('now') WHERE id = ?").run(e.term, e.synonyms, e.description, id);
      invalidate();
      return glossary.get(id);
    },

    remove(id) {
      const ok = db.prepare('DELETE FROM glossary_terms WHERE id = ?').run(id).changes > 0;
      invalidate();
      return ok;
    },

    /** Termos do glossário que aparecem no texto (como palavra ou expressão inteira). */
    match(text) {
      const norm = ` ${normalizeQuery(text)} `;
      if (!norm.trim()) return [];
      const found = [];
      for (const e of entries()) {
        const hit = e.aliases.find((a) => norm.includes(` ${a.norm} `));
        if (hit) found.push({ entry: e, alias: hit });
      }
      return found;
    },

    /**
     * Variações da pergunta trocando cada termo encontrado pelos sinônimos
     * ("emitir ct-e" → "emitir conhecimento de transporte", "emitir cte"…), para a busca por palavras.
     */
    variants(text, max = 8) {
      const base = normalizeQuery(text);
      const out = new Set();
      for (const { entry, alias } of glossary.match(text)) {
        for (const other of entry.aliases) {
          if (other.norm === alias.norm) continue;
          out.add(` ${base} `.replace(` ${alias.norm} `, ` ${other.norm} `).trim());
          if (out.size >= max) return [...out];
        }
      }
      return [...out];
    },

    /** Texto ampliado com os sinônimos entre parênteses (usado na busca semântica). */
    expand(text) {
      const extras = glossary.match(text).map(({ entry, alias }) =>
        entry.aliases.filter((a) => a.norm !== alias.norm).map((a) => a.text).join(', '),
      );
      return extras.length ? `${text} (${extras.filter(Boolean).join('; ')})` : text;
    },

    /** Explicação curta dos termos encontrados, para a Active AI (no máximo `maxChars`). */
    describe(text, maxChars = 450) {
      const lines = [];
      let used = 0;
      for (const { entry } of glossary.match(text)) {
        const line = `- ${entry.term}${entry.synonyms.length ? ` (${entry.synonyms.join(', ')})` : ''}${entry.description ? `: ${entry.description}` : ''}`;
        if (used + line.length > maxChars) break;
        lines.push(line);
        used += line.length + 1;
      }
      return lines.join('\n');
    },
  };
  return glossary;
}
