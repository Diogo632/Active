// Nó "Code" do n8n: remove o rascunho de raciocínio do agente antes da resposta sair para os chats.
//
// Onde colocar: no workflow da Active AI, entre o nó do agente GPTMaker e o nó "Responder ao chat".
// Configuração do nó: Language = JavaScript, Mode = "Run Once for Each Item".
//
// O agente escreve <analise>…</analise> no começo de cada resposta (veja n8n/prompt-raciocinio.md).
// Este código tira esse bloco do texto (para o chat oficial e a Base de Conhecimento) e guarda o
// rascunho no campo "analise", para quem quiser conferir no histórico de execuções do n8n.
//
// IMPORTANTE: no nó "Responder ao chat", devolva também o campo "analise", por exemplo:
//   {{ JSON.stringify({ message: $json.message || '', analise: $json.analise || '' }) }}
// (Response Body com "Respond With = JSON"; este nó Code precisa ficar logo antes do "Responder ao chat".)
// A Base de Conhecimento mostra esse rascunho no botão "!" da resposta; o chat oficial ignora o campo.

const ABRE = /<an[aá]lise>/i;

function separar(texto) {
  if (typeof texto !== 'string' || !ABRE.test(texto)) return { analise: '', resposta: texto };
  const partes = [];
  let resposta = texto.replace(/<an[aá]lise>([\s\S]*?)<\/an[aá]lise>/gi, (_, dentro) => {
    partes.push(dentro.trim());
    return '';
  });
  // Bloco sem fechamento: rascunho só até a primeira linha em branco (nunca esconde a resposta toda).
  const aberto = resposta.match(/<an[aá]lise>([\s\S]*?)(\n\s*\n|$)/i);
  if (aberto) {
    const resto = resposta.slice(aberto.index + aberto[0].length);
    if (resto.trim()) {
      partes.push(aberto[1].trim());
      resposta = resposta.slice(0, aberto.index) + resto;
    } else {
      resposta = resposta.replace(ABRE, '');
    }
  }
  resposta = resposta.trim();
  if (!resposta) return { analise: partes.join('\n'), resposta: texto.replace(/<\/?an[aá]lise>/gi, '').trim() };
  return { analise: partes.join('\n'), resposta };
}

const item = $input.item.json;
const analises = [];

// Limpa os campos de texto mais comuns da resposta do GPTMaker (inclusive dentro de "data").
for (const alvo of [item, item.data].filter((o) => o && typeof o === 'object')) {
  for (const campo of ['message', 'output', 'response', 'text', 'resposta', 'answer', 'reply', 'content']) {
    if (typeof alvo[campo] === 'string') {
      const { analise, resposta } = separar(alvo[campo]);
      alvo[campo] = resposta;
      if (analise) analises.push(analise);
    }
  }
}

if (analises.length) item.analise = analises.join('\n');
return { json: item };
