# 3. Active AI, n8n, GPTMaker e MCP

A Active AI da plataforma é **o mesmo agente do GPTMaker** usado no chat oficial. A plataforma não tem um modelo de IA próprio: ela conversa com o agente pelo **webhook do n8n**, e o agente consulta a base pelo **servidor MCP** da plataforma.

- [Visão geral das duas direções](#visão-geral-das-duas-direções)
- [Plataforma → n8n (webhook)](#plataforma--n8n-webhook)
- [Workflow no n8n](#workflow-no-n8n)
- [Agente → plataforma (MCP)](#agente--plataforma-mcp)
- [Configurar o MCP no GPTMaker](#configurar-o-mcp-no-gptmaker)
- [Prompt recomendado para o agente](#prompt-recomendado-para-o-agente)
- [Tarefas automáticas da plataforma](#tarefas-automáticas-da-plataforma)
- [API de integração (REST)](#api-de-integração-rest)
- [Alternativa: API da Anthropic](#alternativa-api-da-anthropic)

---

## Visão geral das duas direções

| Direção | Para quê | Endereço | Autenticação |
| --- | --- | --- | --- |
| Plataforma → n8n | Enviar a pergunta e receber a resposta | `N8N_WEBHOOK_URL` | Opcional: `N8N_WEBHOOK_TOKEN` (Bearer) |
| GPTMaker → plataforma | Buscar e ler documentos, consultar o glossário, registrar lacunas | `https://ENDERECO/mcp` | `INTEGRATION_TOKEN` (Bearer) |

## Plataforma → n8n (webhook)

### Modos

| Modo | Usado em |
| --- | --- |
| `livre` | Chat (painel e página Active AI) |
| `base` | Resposta da busca |

Nos dois modos a mensagem leva a **regra de fonte**, os documentos da plataforma encontrados e a pergunta. A **base da plataforma vem primeiro**: o agente só usa a base própria do GPT Maker quando a plataforma não tiver a resposta, e nesse caso marca a resposta (veja [Fonte da resposta](#fonte-da-resposta)). Com `N8N_INCLUDE_CONTEXT=false`, vai só a pergunta.

A plataforma pesquisa a base com as palavras-chave da pergunta (sem palavras comuns como "como", "para", "o"), pega até **5 documentos** e monta uma mensagem de no máximo **3.500 caracteres** (`N8N_MAX_PROMPT_CHARS`):

```text
[Consulta feita pela Base de Conhecimento do Suporte]
REGRA DE FONTE: responda com a Base de Conhecimento do Suporte (esta plataforma). Antes de responder sobre processos, clientes ou sistemas, pesquise com buscar_documentos e leia com ler_documento (MCP). Cite os documentos usados como [Título](#/item/ID).
Só se a plataforma não tiver a resposta, use a sua base própria do GPT Maker: nesse caso comece a resposta com a linha [FONTE: BASE GERAL], não misture com os processos da plataforma e chame registrar_lacuna. Saudações e conversa casual não precisam de fonte.

Documentos da plataforma relacionados (use estes primeiro):
- #12 [Emissão de CT-e](#/item/12) · Fiscal · 18200 caracteres (leia com ler_documento)
  "…trecho mais relevante para a pergunta…"
- #7 [Cancelamento de CT-e](#/item/7) · Fiscal · REVISÃO VENCIDA (pode estar desatualizado; avise o usuário)

Pergunta: Como emito um CT-e?
```

A busca é a mesma da tela de busca: por palavras, pelos sinônimos do [glossário](11-login-busca-e-glossario.md#glossário-da-active) e por significado. Quando a pergunta cita termos do glossário, a mensagem também leva a explicação deles (`Termos da Active citados na pergunta (glossário)`, até ~450 caracteres).

Perguntas curtas de continuação ("e o passo 3?") usam também a pergunta anterior para pesquisar. Sem documentos encontrados, a lista é trocada pelo aviso "A busca da plataforma não encontrou documentos para esta pergunta: tente buscar_documentos com outros termos antes de usar a base própria."

### Fonte da resposta

A plataforma confere de onde veio cada resposta:

| Situação | O que a pessoa vê |
| --- | --- |
| A resposta começa com `[FONTE: BASE GERAL]` (o agente usou a base própria do GPT Maker) | A marcação some e aparece o aviso amarelo **Resposta da base geral do GPT Maker**. A pergunta entra no relatório de **lacunas** |
| Resposta longa (300+ caracteres) sem citar nenhum documento (`#/item/ID`) | Aviso cinza **Sem documentos da plataforma**: confira antes de usar |
| Resposta citando documentos da plataforma | Sem aviso |

No log: `grep "active-ai/fonte" servidor.log`.

### Anexos na mensagem

Quando a mensagem tem arquivos anexados, a plataforma acrescenta antes da pergunta:

```text
[Arquivo anexado pelo usuário nesta conversa e guardado na Base de Conhecimento. Antes de responder, leia o conteúdo completo com a ferramenta ler_documento (MCP da Base de Conhecimento) usando {"id": 45}. Se a resposta disser "continua", leia as próximas partes com "inicio".]
- id 45: "contrato-selmi.pdf" (38.210 caracteres)
```

Imagens (prints de tela) têm o texto lido por OCR na hora do envio. O texto curto vai direto na mensagem (até ~700 caracteres por imagem e ~1.500 no total), para o agente ver o erro mesmo sem chamar o MCP:

```text
- id 46: "Screenshot_3n8n.png" (imagem: 161 caracteres de texto lidos da imagem (OCR), em ler_documento; para ver a imagem, use ver_imagem)
  Texto lido da imagem: «Problem in node 'Enviar Romaneio' The resource you are requesting could not be found (404) Romaneio 48213 não encontrado…»
```

### Corpo enviado ao webhook

`POST N8N_WEBHOOK_URL` com `Content-Type: application/json`. Os mesmos dados vão em vários nomes de campo para funcionar com workflows diferentes:

| Campo | Conteúdo |
| --- | --- |
| `prompt` | **A mensagem para o agente** (é o campo lido pelo workflow da Active AI) |
| `contextId`, `sessionId` | Id da conversa (o GPTMaker guarda o histórico por ele) |
| `chatInput`, `message`, `mensagem`, `text` | A mesma mensagem (compatibilidade com Chat Trigger e outros fluxos) |
| `action` | `sendMessage` |
| `pergunta` | Só a pergunta digitada, sem o cabeçalho |
| `historico` | Mensagens anteriores da conversa `[{ role, content }]` |
| `documento_aberto` | `{ id, titulo }` do documento em foco, ou `null` |
| `documentos` | Os documentos da plataforma encontrados `[{ id, titulo, tipo, categoria, tags, resumo, link, conteudo (trecho), parcial, total_caracteres, revisao_vencida }]` (vazio com `N8N_INCLUDE_CONTEXT=false`) |
| `origem` | `base-de-conhecimento` |

Com `N8N_WEBHOOK_TOKEN`, a plataforma envia `Authorization: Bearer <token>` (configure *Header Auth* no webhook do n8n).

### Resposta esperada do n8n

A plataforma aceita vários formatos e procura o texto nestes campos, nesta ordem: `resposta`, `output`, `response`, `message`, `text`, `answer`, `reply`, `content` (também dentro de `json` ou `data`, em listas, ou texto puro). O workflow atual responde `{ "message": "..." }`.

**Opções em botões** (opcional), em qualquer um destes formatos:

- Linha no texto: `[OPCOES] OnSupply | Active Trans | Sistema do cliente` (também `[OPÇÕES]`, `[OPTIONS]`; separador `|` ou `;`).
- Campo da resposta: `options`, `opcoes`, `buttons`, `quick_replies`, `sugestoes`… com uma lista de textos ou de objetos `{ label }`.
- Sem marcação: uma pergunta no fim seguida de lista curta, ou "Qual você usa: Tela 619, Tela 405 ou Tela 299?".

### Tempo de espera e erros

- A plataforma espera até **240 s** (`N8N_TIMEOUT_SECONDS`), porque o agente pode ler vários documentos pelo MCP antes de responder.
- Os erros mostram a causa real: *"demorou mais de 240 s"*, *"a conexão caiu depois de X s (ECONNRESET)"*, *"não foi possível conectar ao n8n (UND_ERR_CONNECT_TIMEOUT)"*, *"o fluxo do n8n retornou erro 500"*. Veja [Solução de problemas](09-solucao-de-problemas.md).

## Workflow no n8n

### Workflow da Active AI que já existe

Use `N8N_WEBHOOK_URL=https://n8n.activecorp.com.br/webhook/active-ia-msg` (workflow **Active IA — Chat hospedado no n8n**). O nó **GPT Maker — Texto** lê `body.prompt` e `body.contextId`, e o nó **Responder ao chat** devolve `{ "message": ... }`. A plataforma envia e lê exatamente esses campos: o workflow não precisa de alteração.

Duas mudanças opcionais no workflow, para o chat oficial também se beneficiar:

- **Raciocínio obrigatório**: nó **Code** com [`n8n/remover-analise.js`](../n8n/remover-analise.js) antes do "Responder ao chat" (veja [abaixo](#raciocínio-obrigatório-antes-de-responder)).
- **Regra de fonte**: a [instrução recomendada](#prompt-recomendado-para-o-agente) no prompt do agente no GPT Maker.

### Fluxo pronto para importar

[`n8n/fluxo-base-conhecimento-gptmaker.json`](../n8n/fluxo-base-conhecimento-gptmaker.json) traz o fluxo **Webhook → GPT Maker → Resposta**:

1. No n8n, crie um workflow vazio e importe o arquivo (**⋯ → Import from File**).
2. No nó **Agente GPTMaker**, troque `SEU_AGENT_ID` e `SEU_TOKEN_GPTMAKER`.
3. Ative o workflow e copie a **Production URL** do nó **Pergunta da Base** para `N8N_WEBHOOK_URL`.

## Agente → plataforma (MCP)

### Endereços

| Transporte | Endereço | Observação |
| --- | --- | --- |
| **Streamable HTTP** (principal) | `POST https://ENDERECO/mcp` | Sem estado: cada chamada é independente |
| SSE (clientes antigos) | `GET https://ENDERECO/mcp/sse` + `POST /mcp/messages?sessionId=…` | |

Autenticação: `Authorization: Bearer <INTEGRATION_TOKEN>` ou `?token=<INTEGRATION_TOKEN>` no endereço (para clientes que não mandam cabeçalhos). Sem `INTEGRATION_TOKEN` no `.env`, o MCP fica desligado. Clientes que não mandam o `Accept` exigido pelo protocolo (caso do GPTMaker) são aceitos mesmo assim.

Toda chamada aparece no log do servidor:

```text
[mcp http] POST /mcp tools/call ler_documento → 200 (42 ms · token: header · accept: application/json · GPTMaker)
[mcp 21:19:04] ler_documento #6 "EDI - NOTFIS 31.pdf" (a partir do caractere 0)
```

### Ferramentas

#### `buscar_documentos`

Pesquisa em texto completo em toda a base (exceto anexos temporários).

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `consulta` | texto (obrigatório) | Palavras-chave |
| `limite` | número 1–25 | Máximo de resultados (padrão 8) |

Busca por palavras, pelos sinônimos do glossário e por significado, como a tela de busca. Retorna uma lista de `{ id, titulo, tipo, categoria, tags, resumo, trecho, aviso, link }`. `tipo` é `texto`, `arquivo`, `vídeo/áudio (transcrição)` ou `vídeo do YouTube (transcrição)`. `aviso` aparece quando a revisão do documento venceu. `encontrado_por` aparece quando o documento foi achado só pelo significado (sem as mesmas palavras). Se a busca citar termos do [glossário](11-login-busca-e-glossario.md#glossário-da-active), a resposta vira `{ glossario: [...], documentos: [...] }`, com a explicação dos termos. Sem resultados, a resposta sugere tentar sinônimos ou chamar `registrar_lacuna`.

#### `ler_documento`

Lê o conteúdo completo de um documento, em partes de **30.000 caracteres**.

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `id` | número ou texto | Id do documento (`6`, `"6"` e `"#6"` funcionam) |
| `inicio` | número ou texto | Posição inicial (padrão 0) |

Retorna:

| Campo | Quando |
| --- | --- |
| `id`, `titulo`, `tipo`, `categoria`, `tags`, `resumo`, `arquivo`, `link`, `atualizado_em` | Sempre (quando existem) |
| `conteudo` | O trecho lido (texto, conteúdo extraído do arquivo ou transcrição com `[hh:mm:ss]`) |
| `total_caracteres` | Tamanho total do conteúdo |
| `continua`, `proximo_inicio` | Quando há mais partes para ler |
| `duracao` | Vídeos e áudios |
| `video_youtube` | Vídeos do YouTube (o link) |
| `resumo_do_video`, `capitulos` | Vídeos com resumo e capítulos gerados (`["00:00:40 Cadastro do cliente", …]`) |
| `observacao` | Transcrição ainda não pronta |
| `anexo_da_conversa` | Anexo temporário enviado no chat |
| `aviso` | Revisão vencida |

#### `listar_documentos`

`categoria_id` (opcional) e `limite` (1–100, padrão 30). Retorna `{ total, documentos: [{ id, titulo, categoria, atualizado_em, link }] }`, dos mais recentes para os mais antigos.

#### `listar_categorias`

Sem parâmetros. Retorna `[{ id, nome, descricao, documentos }]`.

#### `consultar_glossario`

Explica termos, siglas e nomes internos cadastrados no [glossário](11-login-busca-e-glossario.md#glossário-da-active).

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `termo` | texto | Termo, sigla ou frase. Sem ele, lista o glossário inteiro (até 50 termos) |

Retorna `[{ termo, sinonimos, significado }]`.

#### `ver_imagem`

Devolve a própria imagem (PNG, JPEG, GIF ou WebP até 5 MB) de um documento ou anexo, junto com o texto lido por OCR, para agentes que enxergam imagens (cores, destaques, posição de campos).

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `id` | número ou texto | Id da imagem |

Retorna um bloco de texto e um bloco `image` (`data` em base64 e `mimeType`), no formato padrão do MCP. Se o GPT Maker não repassar imagens ao modelo, o agente continua com o texto lido por OCR, que vem no `ler_documento` (com `tipo: "imagem (texto lido por OCR)"` e uma `observacao`).

#### `registrar_lacuna`

Registra uma pergunta que a base não respondeu (entra no [relatório de lacunas](02-guia-de-uso.md#relatório-da-base)).

| Parâmetro | Tipo | Descrição |
| --- | --- | --- |
| `pergunta` | texto (obrigatório, 3+ caracteres) | A pergunta do usuário |
| `detalhe` | texto | O que foi procurado e por que não serviu |

### Links devolvidos ao agente

Os links (`link`) usam o `PUBLIC_URL` do `.env` (ex.: `https://base.activecorp.com.br/#/item/12`). Sem `PUBLIC_URL`, vão só como `#/item/12`, que funcionam dentro da plataforma.

## Configurar o MCP no GPTMaker

1. Gere o token: `npm run gerar-token` e coloque em `INTEGRATION_TOKEN=` no `.env`. Defina também `PUBLIC_URL=` com o endereço público. Reinicie a plataforma.
2. Teste antes, como o agente faria:
   ```bash
   npm run mcp:testar -- https://ENDERECO SEU_TOKEN
   ```
   Deve listar as 7 ferramentas e fazer uma busca. O endereço pode ir com ou sem `/mcp`.
3. No GPTMaker, nas configurações do agente, adicione um servidor MCP:
   - **Tipo**: Streamable HTTP
   - **URL**: `https://ENDERECO/mcp`
   - **Autenticação**: *Headers* (não OAuth), chave `Authorization`, valor `Bearer SEU_TOKEN`
4. Ao trocar o endereço ou o token, ou quando a plataforma ganhar ferramentas novas, **reconecte** o MCP no GPTMaker.
5. Para conferir, use *Inspecionar resposta* numa mensagem do agente: aparecem as ferramentas chamadas e os dados enviados e recebidos.

Outros clientes MCP usam o mesmo endereço e o mesmo token: no **n8n**, o nó **MCP Client Tool** (com *Header Auth*) ligado a um **AI Agent**; também Claude, ChatGPT, Cursor e outros. Clientes que não mandam cabeçalhos podem usar `https://ENDERECO/mcp?token=<INTEGRATION_TOKEN>`.

Para testar pelo Codespace, a porta precisa estar **pública**; se o endereço do Codespace der 404, use o túnel descrito em [5. Instalação](05-instalacao-e-configuracao.md#testar-pelo-github-codespaces) e coloque o endereço `https://….trycloudflare.com/mcp` no GPT Maker (ele muda a cada vez que o túnel é aberto).

## Prompt recomendado para o agente

Acrescente ao prompt do agente no GPTMaker:

> Você tem acesso à Base de Conhecimento do Suporte pelas ferramentas `buscar_documentos` e `ler_documento`. Ela é a **fonte principal**: sempre que a pergunta envolver processos, clientes, sistemas ou procedimentos, pesquise nela antes de responder e use só o que estiver nela. Só se ela não tiver a resposta, use a sua base de treinamento; nesse caso comece a resposta com a linha `[FONTE: BASE GERAL]` e nunca misture processos das duas bases na mesma resposta. Quando a mensagem citar um documento ou arquivo por id (ex.: "Documento aberto na tela: #12" ou `{"id": 45}`), leia-o com `ler_documento`, continuando com `inicio` enquanto a resposta indicar que há mais partes. Se o arquivo for uma imagem (print de tela), o texto dela já vem lido; use `ver_imagem` quando precisar enxergar a imagem. Cite os documentos usados como [Título](#/item/ID). Em vídeos, cite o minuto do trecho. Se a base não tiver a resposta (depois de tentar sinônimos), chame `registrar_lacuna` com a pergunta do usuário. Se um documento vier com "aviso" de revisão vencida, avise o usuário que o procedimento pode estar desatualizado. Quando quiser oferecer alternativas, termine com a linha `[OPCOES] Opção A | Opção B | Opção C`.

### Raciocínio obrigatório antes de responder

Para o agente não responder com "o assunto mais parecido" que encontrou, o prompt pode exigir um **rascunho de análise** no começo de toda resposta, entre `<analise>` e `</analise>`: ação, objeto exato, contexto, o que encontrou, se responde exatamente e a decisão (responder, perguntar antes ou dizer que não há na base). Escrever esse rascunho obriga o modelo a comparar o que achou com o que foi perguntado.

| Parte | Onde | O que faz |
| --- | --- | --- |
| Trecho do prompt | [`n8n/prompt-raciocinio.md`](../n8n/prompt-raciocinio.md) → colar no prompt do agente no GPTMaker | Exige o rascunho e as regras de decisão |
| Filtro na plataforma | Automático (`splitAnalysis` em `server/n8n.js`) | Tira o rascunho do texto da resposta, mostra-o só ao clicar no **!** da mensagem e registra no log: `[active-ai/análise] sessão \| pergunta ⇒ rascunho` |
| Filtro no n8n | [`n8n/remover-analise.js`](../n8n/remover-analise.js) → nó **Code** entre o agente e o "Responder ao chat" | Tira o rascunho para o **chat oficial** também; guarda o rascunho no campo `analise` (a plataforma registra esse campo no log) |

Ordem para ativar: **primeiro** o nó no n8n, **depois** o trecho no prompt (senão o chat oficial mostra o rascunho). No nó **"Responder ao chat"**, inclua também o campo `analise` na resposta (no *Response Body*, com *Respond With = JSON*: `{{ JSON.stringify({ message: $json.message || '', analise: $json.analise || '' }) }}`; o nó **Code** precisa vir logo antes), senão o **!** da plataforma não tem o que mostrar. Para ver os rascunhos: `grep "active-ai/análise" servidor.log | tail`.

Se o bloco vier sem o fechamento `</analise>`, só o trecho até a primeira linha em branco é tratado como rascunho; a plataforma nunca esconde a resposta inteira.

## Tarefas automáticas da plataforma

Além das perguntas das pessoas, a plataforma usa o mesmo webhook para:

| Tarefa | Quando | Detalhes |
| --- | --- | --- |
| **Resumo e capítulos de vídeos** | Ao terminar uma transcrição (ou em *Gerar resumo e capítulos*) | Sessão própria `kb-capitulos-<id>-…`; a mensagem pede o formato `RESUMO:` + `CAPITULOS:` com `[hh:mm:ss] assunto`. Transcrições curtas vão na própria mensagem; nas longas, o agente lê pelo MCP. Desligue com `CHAPTERS=off`. Veja [vídeos](04-videos-e-transcricao.md#resumo-e-capítulos) |

Essas mensagens aparecem no histórico do GPTMaker como conversas separadas.

### Detecção de "não encontrei"

Depois de cada resposta, a plataforma verifica se o texto diz que a informação não foi encontrada (por exemplo: *"não encontrei"*, *"não localizei"*, *"não há informações"*, *"não consta na base"*, *"não tenho essa informação"*, *"não sei responder"*) ou se a resposta veio marcada com `[FONTE: BASE GERAL]`. Nos dois casos, a pergunta entra no relatório de lacunas com a origem *Active AI não encontrou* (no segundo, o detalhe começa com "Respondida com a base geral do GPT Maker").

## API de integração (REST)

Para fluxos do n8n ou scripts que preferem REST em vez de MCP (somente leitura, com o mesmo `INTEGRATION_TOKEN`):

| Rota | Retorno |
| --- | --- |
| `GET /api/integracao/buscar?q=palavras&limite=8` | `[{ id, titulo, categoria, tags, resumo, trecho, link }]` (sem `q`: os mais recentes; `limite` até 25) |
| `GET /api/integracao/documentos/{id}` | `{ id, titulo, tipo, categoria, tags, resumo, arquivo, conteudo }` (conteúdo completo) |

Com `N8N_INCLUDE_CONTEXT=false`, a plataforma deixa de mandar referências aos documentos na mensagem (útil se o workflow consultar a base sozinho por essa API).

## Alternativa: API da Anthropic

Se `N8N_WEBHOOK_URL` estiver vazio e `ANTHROPIC_API_KEY` estiver definido (ou `ACTIVE_IA_PROVIDER=anthropic`), a plataforma usa um assistente próprio com a API da Anthropic (modelo em `ACTIVE_IA_MODEL`), com as mesmas ferramentas de busca e leitura e respostas em tempo real. Hoje a Active Corp usa o GPTMaker; essa opção fica como alternativa.
