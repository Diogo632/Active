import { normalizeQuery } from './db.js';

// Frases típicas de quando o agente não encontra a resposta (comparadas sem acentos e em minúsculas).
const NOT_FOUND = [
  /\bnao (encontrei|localizei|achei|identifiquei)\b/,
  /\bnao (foi possivel|consegui) (encontrar|localizar|achar|identificar)\b/,
  /\bnao (ha|existe|existem|consta|constam|temos|tenho|possuo|possui) (nenhum|nenhuma|informac|document|registro|dados|conteudo|material|procedimento|artigo|detalhe)/,
  /\bnao (tenho|possuo) (essa|esta|essas|estas) informac/,
  /\bnao (consta|constam|aparece|aparecem) (na|nos|no) (base|documento)/,
  /\bsem (informac|document|registro)[a-z]* (sobre|a respeito|na base)/,
  /\bnao sei (responder|informar|dizer)\b/,
  /\b(fora|alem) do (meu|que tenho de) conhecimento\b/,
];

/** Indica se a resposta da Active AI diz que não encontrou a informação. */
export function looksUnanswered(reply) {
  const text = normalizeQuery(reply);
  if (!text) return false;
  return NOT_FOUND.some((re) => re.test(text));
}
