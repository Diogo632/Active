// Extrai "opções de resposta" (botões) do texto enviado pelo agente.
//
// Formatos reconhecidos (os mesmos da página da Active AI no n8n, mais alguns extras):
//  0. Linha "[OPCOES] Opção A | Opção B | Opção C" (também [OPÇÕES], [OPTIONS]; separador | ou ;) —
//     é o formato que o agente do GPTMaker usa hoje.
//  0b. Sem marcação: última linha é uma pergunta com as alternativas em **negrito** ou depois de ":"
//     separadas por vírgula/"ou" (ex.: "Qual você usa: Tela 619, Tela 405 ou Tela 299?").
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
    .replace(/^[-•\s]+/, '')
    .replace(/[.;]+$/, '')
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

// Mesma expressão da página da Active AI.
const OPT_RE = /^[ \t]*\[(?:OP[ÇC][ÕO]ES|OPTIONS)\][ \t]*:?[ \t]*(.+)$/im;

// Dedução a partir da última pergunta, igual à página da Active AI.
function inferFromLastQuestion(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  const last = lines.length ? lines[lines.length - 1].trim() : '';
  if (!/\?\s*$/.test(last) || !/,|\bou\b/i.test(last)) return [];
  const bold = last.match(/\*\*([^*\n]{1,40})\*\*/g);
  if (bold && bold.length >= 2) return bold.map((b) => b.replace(/\*\*/g, ''));
  const tail = last.replace(/\?+\s*$/, '');
  const i = tail.lastIndexOf(':');
  if (i < 0) return [];
  const parts = tail
    .slice(i + 1)
    .split(/\s*,\s*|\s+ou\s+/i)
    .map((x) => x.trim())
    .filter(Boolean);
  return parts.length >= 2 && parts.length <= 6 && parts.every((x) => x.length <= 40) ? parts : [];
}

export function parseOptions(text) {
  let body = String(text || '');
  let options = [];

  // 0. [OPCOES] A | B | C
  const marked = body.match(OPT_RE);
  if (marked) {
    options.push(...marked[1].split(/\s*[|;]\s*/).map(clean));
    body = body.replace(OPT_RE, '');
  }

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

  // 0b. Alternativas na última pergunta (negrito ou depois de ":").
  if (!options.length) options = inferFromLastQuestion(body).map(clean);

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
