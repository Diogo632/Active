// Extrai "opções de resposta" (botões) do texto enviado pelo agente.
//
// Formatos reconhecidos:
//  1. Marcação explícita: linhas "[[Opção]]" ou "[[Opção A | Opção B]]", ou um bloco <opcoes>A | B</opcoes>.
//  2. Lista curta no fim da mensagem, logo após um parágrafo com uma pergunta, por exemplo:
//       Qual identificador você vai usar?
//       - Chave eletrônica
//       - NF ou pedido
//       - CT-e
//     Os itens viram botões e saem do texto.

const MAX_OPTIONS = 8;
const MAX_LABEL = 60;
const LIST_ITEM = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.+?)\s*$/;

const clean = (s) =>
  s
    .replace(/\*\*|__|`/g, '')
    .replace(/^\[(.+)\]\(.+\)$/, '$1')
    .trim();

function uniq(list) {
  const seen = new Set();
  return list.filter((o) => {
    const key = o.toLowerCase();
    if (!o || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseOptions(text) {
  let body = String(text || '');
  let options = [];

  // 1a. Bloco <opcoes>…</opcoes> ou <botoes>…</botoes>
  body = body.replace(/<(opc[oõ]es|botoes|options)>([\s\S]*?)<\/\1>/gi, (_, _tag, inner) => {
    options.push(...inner.split(/\||\n/).map(clean));
    return '';
  });

  // 1b. Linhas [[…]]
  body = body.replace(/^[ \t]*\[\[(.+?)\]\][ \t]*$/gm, (_, inner) => {
    options.push(...inner.split('|').map(clean));
    return '';
  });

  // 2. Lista curta no final, logo depois de uma pergunta.
  if (!options.length) {
    const lines = body.trimEnd().split('\n');
    let i = lines.length - 1;
    const items = [];
    while (i >= 0 && LIST_ITEM.test(lines[i])) {
      items.unshift(clean(lines[i].match(LIST_ITEM)[1]));
      i--;
    }
    while (i >= 0 && !lines[i].trim()) i--;
    const lead = i >= 0 ? clean(lines[i]) : '';
    const looksLikeChoices =
      items.length >= 2 &&
      items.length <= MAX_OPTIONS &&
      items.every((o) => o.length <= MAX_LABEL && !/[.;]$/.test(o)) &&
      // O parágrafo logo antes da lista precisa conter uma pergunta (em qualquer ponto dele).
      lead.includes('?');
    if (looksLikeChoices) {
      options = items;
      body = lines.slice(0, i + 1).join('\n');
    }
  }

  options = uniq(options.filter((o) => o.length <= MAX_LABEL * 2)).slice(0, MAX_OPTIONS);
  return { text: body.replace(/\n{3,}/g, '\n\n').trim(), options };
}

/** Normaliza opções recebidas do servidor (strings ou objetos {label|text|title|value}). */
export function normalizeOptions(list) {
  if (!Array.isArray(list)) return [];
  return uniq(
    list
      .map((o) => (typeof o === 'string' ? o : o?.label || o?.text || o?.title || o?.value || ''))
      .map((o) => clean(String(o)))
      .filter(Boolean),
  ).slice(0, MAX_OPTIONS);
}
