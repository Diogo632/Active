/**
 * Busca da plataforma: junta a busca por palavras (FTS5), as variações com os sinônimos do glossário
 * e a busca por significado (semântica), com Reciprocal Rank Fusion: quem aparece bem colocado em
 * mais de uma lista sobe. Usada pela tela de busca, pela resposta da Active AI e pelo MCP.
 */
export function createSearchService({ repo, semantic, glossary, log = console }) {
  const RRF_K = 60;

  return {
    // meaningText: texto para a busca por significado (ex.: a pergunta inteira), quando `text` são só palavras-chave.
    async search(text, { categoryId, kind, limit = 20, meaningText } = {}) {
      const query = String(text || '').trim();
      if (!query) return [];
      const lists = [repo.search(query, { categoryId, kind, limit: 30 })];
      for (const variant of glossary?.variants(query) || []) lists.push(repo.search(variant, { categoryId, kind, limit: 30 }));

      let meaning = [];
      if (semantic?.ready) {
        try {
          const sentence = String(meaningText || query);
          meaning = await semantic.search(glossary ? glossary.expand(sentence) : sentence, { limit: 30 });
          if (meaning.length) {
            log.log(`[busca semântica] "${query.slice(0, 80)}" → ${meaning.slice(0, 3).map((m) => `#${m.id} ${m.score.toFixed(3)}`).join(', ')}`);
          }
        } catch (err) {
          log.error('[busca semântica] Falha na busca:', err.message);
        }
      }

      const score = new Map();
      const rows = new Map();
      const add = (id, rank) => score.set(id, (score.get(id) || 0) + 1 / (RRF_K + rank));
      for (const list of lists) {
        list.forEach((item, rank) => {
          add(item.id, rank);
          if (!rows.has(item.id)) rows.set(item.id, item);
        });
      }
      const missing = meaning.filter((m) => !rows.has(m.id)).map((m) => m.id);
      const extra = new Map(repo.getItems(missing).map((i) => [i.id, i]));
      meaning.forEach((m, rank) => {
        let item = rows.get(m.id) || extra.get(m.id);
        if (!item || item.temporary) return;
        if (categoryId === 'none' ? item.category_id != null : categoryId && String(item.category_id) !== String(categoryId)) return;
        if (kind && item.kind !== kind) return;
        add(m.id, rank);
        if (!rows.has(m.id)) {
          // Encontrado só pelo significado: o trecho mostrado é o pedaço mais parecido do documento.
          const excerpt = m.text.split('\n').slice(1).join(' ').replace(/\s+/g, ' ').trim();
          rows.set(m.id, { ...item, snippet: excerpt.length > 240 ? `${excerpt.slice(0, 240)} …` : excerpt, by_meaning: true });
        }
      });

      return [...score.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id]) => rows.get(id))
        .filter(Boolean);
    },
  };
}
