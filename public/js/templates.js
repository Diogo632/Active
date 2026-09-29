// Modelos de texto do Suporte: estrutura padronizada, mais fácil de ler para a equipe e para a Active AI.
export const TEMPLATES = [
  {
    id: 'problema',
    name: 'Problema → Causa → Solução',
    hint: 'Erros e dúvidas de clientes',
    content: `## Problema

_Descreva o sintoma ou a dúvida como o cliente relata (mensagem de erro, tela, sistema)._

## Causa

_Por que acontece._

## Solução

1. …
2. …

## Observações

- **Sistema / versão:**
- **Clientes afetados:**
`,
  },
  {
    id: 'passo',
    name: 'Passo a passo',
    hint: 'Procedimentos e configurações',
    content: `## Objetivo

_O que este procedimento resolve ou configura._

## Antes de começar

- …

## Passo a passo

1. …
2. …
3. …

## Resultado esperado

_Como confirmar que deu certo._

## Problemas comuns

- **Sintoma:** … → **O que fazer:** …
`,
  },
  {
    id: 'comunicado',
    name: 'Comunicado',
    hint: 'Mudanças, avisos e novidades',
    content: `## Resumo

_O aviso em uma ou duas frases._

## O que mudou

…

## Quem é afetado

…

## A partir de quando

…

## O que o Suporte deve fazer

…
`,
  },
];

/** Remove a linha de opções do agente ([OPCOES] …) e espaços sobrando. */
const cleanAnswer = (text) =>
  String(text || '')
    .replace(/^\s*\[OP[CÇ][OÕ]ES\].*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const titleFrom = (question) => {
  const t = String(question || '').replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '');
  const short = t.length > 90 ? `${t.slice(0, 87).replace(/\s+\S*$/, '')}…` : t;
  return short.charAt(0).toUpperCase() + short.slice(1);
};

/** Rascunho de texto a partir de uma resposta da Active AI, já no modelo Problema → Causa → Solução. */
export function draftFromAnswer({ question, answer }) {
  const today = new Date().toLocaleDateString('pt-BR');
  return {
    title: titleFrom(question),
    tags: 'active-ai',
    template: 'problema',
    content: `## Problema

${String(question || '').trim()}

## Causa

_Preencha se souber._

## Solução

${cleanAnswer(answer)}

> Texto criado a partir de uma resposta da Active AI em ${today}. Revise antes de publicar.
`,
  };
}

/** Rascunho para escrever o documento que falta, a partir de uma lacuna do relatório. */
export function draftFromGap(query, templateId = 'problema') {
  const template = TEMPLATES.find((t) => t.id === templateId) || TEMPLATES[0];
  return {
    title: titleFrom(query),
    template: template.id,
    content: template.content.replace(
      /_Descreva o sintoma ou a dúvida como o cliente relata[^_]*_/,
      `${String(query || '').trim()}\n\n_Complete com a mensagem de erro, a tela e o sistema._`,
    ),
    lacuna: query,
  };
}

// O rascunho passa para o editor pela sessão do navegador.
const DRAFT_KEY = 'kb-draft';

export function openDraft(draft) {
  try {
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* sem armazenamento: abre o editor vazio */
  }
  location.hash = '#/new?rascunho=1';
}

export function takeDraft() {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    sessionStorage.removeItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
