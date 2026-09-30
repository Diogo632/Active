# Base de Conhecimento · Suporte Active Corp

Plataforma web para a base de conhecimento do setor de Suporte da Active Corp, com a assistente **Active AI** integrada.

## Funcionalidades

- **Textos**: escreva procedimentos, soluções e comunicados direto na plataforma. O editor usa Markdown e tem barra de formatação, visualização lado a lado e atalhos (Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+S).
- **Documentos de qualquer tipo**: envie vários arquivos de uma vez, arrastando para a tela. O conteúdo é lido automaticamente para a pesquisa e para a Active AI nestes formatos:
  - PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`), LibreOffice (`.odt`, `.ods`, `.odp`), RTF e EPUB
  - Textos, Markdown, CSV, JSON, XML, HTML, logs e código-fonte
  - Imagens (PNG, JPG, GIF, WebP): a Active AI consegue analisá-las visualmente

  Outros formatos (`.zip`, `.exe`, `.doc` antigo etc.) também podem ser guardados e baixados. Nesses casos a Active AI vê só o título, a descrição e as tags.
- **Vídeos e áudios (treinamentos com clientes, reuniões)**: são **transcritos automaticamente** no próprio servidor, em segundo plano. A transcrição vira o conteúdo do item, com marcações de tempo (`[00:12:34] …`). Assim, ela entra na pesquisa, e a Active AI a lê pelo MCP para resumir o treinamento, explicar trechos e dizer em que momento cada assunto aparece. Na tela do vídeo, clicar no horário leva o player até o trecho. Também é possível enviar uma transcrição pronta (`.vtt`/`.srt` do Teams, Meet ou Zoom, `.txt` ou `.docx`), que substitui a automática.
- **Vídeos do YouTube**: cole o link em *Enviar arquivos*. O vídeo toca dentro da plataforma, e a transcrição vem das legendas do próprio YouTube, então a Active AI conversa sobre ele como sobre qualquer outro vídeo. Se o vídeo não tiver legendas, cole a transcrição copiada do YouTube (*Mostrar transcrição*).
- **Resumo e capítulos dos vídeos**: quando a transcrição termina, a Active AI cria um resumo e um índice de capítulos, por exemplo "0:40 Cadastro do cliente · 1:15 Transmissão para a SEFAZ". Clicar no capítulo leva o vídeo até o ponto.
- **Relatório da base** (menu *Relatório*):
  - **Lacunas**: buscas sem resultado, perguntas que a Active AI não soube responder, respostas avaliadas com 👎 e avisos do próprio agente (ferramenta MCP `registrar_lacuna`). As perguntas iguais são agrupadas, das mais frequentes para as menos. **Escrever documento** abre o editor já no modelo, e ao publicar a lacuna sai da lista.
  - **Para revisar**: documentos que passaram do prazo de revisão.
  - **Avaliações**: documentos com 👎 e os comentários, e as respostas da Active AI que não ajudaram.
- **"Isso ajudou? 👍 👎"** no fim de cada documento e nas respostas longas da Active AI (chat e busca; saudações e respostas curtas não têm). No 👎, a pessoa pode dizer o que faltou.
- **Anexar arquivos na conversa com a Active AI** (📎 ou arrastando para o chat): o arquivo fica guardado **temporariamente** na plataforma (fora das listas e da busca, apagado depois de 72 horas) e o agente recebe só o id. Ele lê o conteúdo **inteiro** pelo MCP (`ler_documento`), sem o limite de texto da mensagem do GPTMaker. Se o arquivo for útil para a equipe, *Manter na base* o transforma num documento normal.
- **Histórico de versões**: cada edição de um texto guarda a versão anterior. Em *Histórico*, dá para ver qualquer versão e restaurá-la; a versão atual também fica guardada.
- **Data de revisão**: cada documento pode ter um prazo de revisão (padrão de 6 meses para textos novos). Passado esse prazo sem atualização, o documento mostra um aviso com *Continua válido* e *Atualizar*, e a Active AI avisa quem pergunta que o conteúdo pode estar desatualizado.
- **Modelos de texto**: *Problema → Causa → Solução*, *Passo a passo* e *Comunicado*, escolhidos ao escrever um texto novo.
- **Visualização**: PDFs, imagens, vídeos e áudios abrem dentro da plataforma. Você pode baixar o arquivo e enviar uma nova versão.
- **Organização**: categorias com ícone, tags e descrição curta.
- **Pesquisa em texto completo**: busca em títulos, tags, descrições e conteúdo, ignorando acentos, com trechos destacados.
- **Busca em primeiro lugar**: a tela inicial é uma busca. Os resultados trazem a **resposta da Active AI** com links para os documentos, e **Ctrl+K** (ou `/`) abre a busca rápida de qualquer tela.
- **Active AI** (agente do GPTMaker, via n8n):
  - **conversa livre** no chat, usando o conhecimento próprio do agente;
  - resumos e dúvidas sobre o documento aberto;
  - **servidor MCP** para o agente pesquisar e ler a base sozinho.
- **Mais acessados**: a tela inicial mostra os documentos mais abertos pela equipe.
- **Opções de resposta em botões**, iguais às da Active AI. A plataforma usa a mesma regra da página da Active AI: a linha `[OPCOES] A | B | C` enviada pelo agente, ou as alternativas deduzidas da última pergunta. Também aceita uma lista curta depois de uma pergunta, `[[A | B]]` ou um campo `options` na resposta do n8n.
- **Animações** em JavaScript (Web Animations API): entrada das telas em cascata, mensagens do chat, revelação das respostas, botões com onda ao clicar e busca rápida animada. Tudo respeita a opção "reduzir movimento" do sistema.
- Tema claro/escuro e layout responsivo (funciona no celular).

## Testar pelo GitHub (Codespaces)

Dá para rodar a plataforma na nuvem do GitHub, sem instalar nada no computador:

1. No GitHub, abra o repositório e clique em **Code → Codespaces → Create codespace**.
2. Espere alguns minutos: o Codespace instala as dependências.
3. No terminal, rode `npm start`. Quando aparecer o aviso da porta **3000**, espere uns segundos e clique em **Open in Browser**. O endereço também aparece na aba **Ports**.

Para atualizar depois de novas versões: pare a plataforma (Ctrl+C) e rode `git pull`, `npm ci` e `npm start`.

Para usar a Active AI, cadastre o secret `N8N_WEBHOOK_URL` em **GitHub → Settings → Codespaces → Secrets**, liberado para este repositório. Depois recrie ou reinicie o Codespace.

## Como rodar

Requisitos: **Node.js 20+**.

```bash
npm install
cp .env.example .env      # depois edite o .env (N8N_WEBHOOK_URL)
npm start                 # http://localhost:3000
```

Configurações do `.env`:

| Variável | Descrição |
| --- | --- |
| `N8N_WEBHOOK_URL` | URL de produção do webhook do n8n que responde como Active AI (ex.: fluxo com o agente do GPTMaker). Sem ela, a base funciona normalmente e só a Active AI fica indisponível. |
| `N8N_WEBHOOK_TOKEN` | Opcional: enviado como `Authorization: Bearer <token>` (configure *Header Auth* no webhook). |
| `N8N_TIMEOUT_SECONDS` | Tempo máximo de espera pela resposta (padrão `240`; o agente pode ler vários documentos pelo MCP antes de responder). |
| `INTEGRATION_TOKEN` | Opcional: libera a API de integração para o n8n consultar a base (veja abaixo). |
| `PORT` | Porta HTTP (padrão `3000`). |
| `DATA_DIR` | Pasta do banco SQLite e dos arquivos enviados (padrão `./data`). **Faça backup desta pasta.** |
| `MAX_UPLOAD_MB` | Tamanho máximo por arquivo (padrão `2048`, para caber vídeos de treinamento). |
| `TRANSCRIPTION` | `local` (padrão) transcreve vídeos e áudios no servidor com o Whisper; `off` desliga (aí só vale a transcrição enviada manualmente). |
| `TRANSCRIPTION_MODEL` | Modelo do Whisper (padrão `Xenova/whisper-small`). `Xenova/whisper-base` é mais rápido e menos preciso; `Xenova/whisper-medium` é mais preciso e mais lento. |
| `TRANSCRIPTION_DTYPE` | Precisão do modelo (padrão `q8`, mais leve). |
| `FFMPEG_PATH` | Opcional: caminho de um ffmpeg já instalado (por padrão usa o que vem com o `npm ci`). |
| `CHAPTERS` | `auto` (padrão) pede à Active AI o resumo e os capítulos de cada vídeo transcrito; `off` desliga. |
| `YTDLP_PATH` | Opcional: caminho do [yt-dlp](https://github.com/yt-dlp/yt-dlp). Com ele instalado, vídeos do YouTube sem legendas têm o áudio baixado e transcrito pelo Whisper. |
| `CHAT_ATTACHMENT_HOURS` | Por quantas horas os arquivos anexados na conversa com a Active AI ficam guardados (padrão `72`). |
| `REVIEW_MONTHS_DEFAULT` | Prazo de revisão padrão dos textos novos, em meses (padrão `6`; `0` desliga). |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | Opcional: exige usuário e senha para acessar a plataforma. |
| `ANTHROPIC_API_KEY` | Alternativa ao n8n: usa a API da Anthropic, só quando `N8N_WEBHOOK_URL` está vazio. |

## Como a Active AI funciona na plataforma

| Onde | O que é enviado ao agente | Para quê |
| --- | --- | --- |
| **Chat** (botão *Perguntar à Active AI*) | Só a pergunta (**conversa livre**) | O agente responde com o próprio conhecimento (RAG do GPTMaker) e consulta a base pelo **MCP** quando precisa |
| **Busca** (resultados e Ctrl+K) | Pergunta + referências curtas aos documentos encontrados (id, título, trecho) | O cartão *Resposta da Active AI* responde a busca; o agente lê os documentos completos pelo **MCP** |
| **Documento em foco** (*Perguntar à Active AI* dentro de um documento) | Pergunta + id e título do documento aberto | O agente lê o documento pelo **MCP** (`ler_documento`) para resumir ou tirar dúvidas |

A mensagem enviada ao agente tem **no máximo 3.500 caracteres** (`N8N_MAX_PROMPT_CHARS`), porque o GPTMaker só enxerga cerca de 4.000 caracteres por mensagem. O conteúdo completo dos documentos nunca vai na mensagem: o agente busca pelo MCP.

O botão **Continuar a conversa** leva a resposta da busca para o chat e mantém a mesma sessão no agente.

## Servidor MCP da Base de Conhecimento

A plataforma expõe um servidor **MCP** em dois formatos. O principal é o *Streamable HTTP*, em `https://SEU_ENDERECO/mcp`. Para clientes mais antigos, há também o *SSE*, em `https://SEU_ENDERECO/mcp/sse`. Para ativar, defina `INTEGRATION_TOKEN` no `.env`. A autenticação é pelo header `Authorization: Bearer <INTEGRATION_TOKEN>`. Para clientes que não enviam headers, também dá para usar `https://SEU_ENDERECO/mcp?token=<INTEGRATION_TOKEN>`.

Ferramentas disponíveis:

| Ferramenta | O que faz |
| --- | --- |
| `buscar_documentos` | Pesquisa em texto completo; devolve id, título, categoria, trecho, link e um aviso quando a revisão do documento venceu |
| `ler_documento` | Lê o conteúdo completo de um documento (em partes de 30 mil caracteres). Em vídeos, traz a transcrição, o resumo, os capítulos e o link do YouTube |
| `listar_documentos` | Lista os documentos mais recentes, opcionalmente de uma categoria |
| `listar_categorias` | Lista as categorias e quantos documentos cada uma tem |
| `registrar_lacuna` | O agente avisa que a base não tem a resposta de uma pergunta; ela entra no relatório de lacunas |

### Testar o MCP antes de hospedar (Codespace)

1. Gere um token com `npm run gerar-token`. No `.env`, defina:
   - `INTEGRATION_TOKEN=<token gerado>`;
   - `BASIC_AUTH_USER` e `BASIC_AUTH_PASSWORD`, para proteger as telas enquanto a porta estiver pública.
2. Inicie a plataforma com `PORT=3001 npm start`.
3. Em outro terminal, rode `npm run mcp:testar -- "" "" palavra`. Ele testa o MCP localmente, com busca e leitura de um documento.
4. Na aba **Portas**, clique com o botão direito na 3001 e escolha **Visibilidade da Porta → Pública**. Copie o endereço (`https://…-3001.app.github.dev`), coloque-o em `PUBLIC_URL` no `.env` e reinicie.
5. Teste pelo endereço público: `npm run mcp:testar -- https://…-3001.app.github.dev/mcp`.
6. Configure o GPTMaker com esse endereço (passos abaixo) e faça perguntas à Active AI.

O `/mcp` e o `/api/integracao` exigem o token, mesmo com a porta pública. O usuário e a senha protegem só as telas da plataforma.

### Conectar a Active AI (GPTMaker) ao MCP

1. Hospede a plataforma num endereço público (HTTPS) e defina no `.env`:
   - `INTEGRATION_TOKEN`: uma senha longa e aleatória;
   - `PUBLIC_URL`: o endereço público.
2. No GPTMaker, abra o agente da Active AI e adicione uma integração **MCP**:
   - **URL:** `https://SEU_ENDERECO/mcp`. Se o GPTMaker pedir SSE, use `https://SEU_ENDERECO/mcp/sse`.
   - **Autenticação:** header `Authorization: Bearer <INTEGRATION_TOKEN>`. Se não houver campo de header, coloque `?token=<INTEGRATION_TOKEN>` no fim da URL.
3. Nas instruções do agente, acrescente algo como:

   > Você tem acesso à Base de Conhecimento do Suporte pelas ferramentas `buscar_documentos` e `ler_documento`. Sempre que a pergunta envolver processos, clientes, sistemas ou procedimentos, pesquise na base antes de responder. Quando a mensagem citar um documento por id (ex.: "Documento aberto na tela: #12"), leia-o com `ler_documento`. Cite os documentos usados como [Título](#/item/ID). Se a base não tiver a resposta (depois de tentar sinônimos), chame `registrar_lacuna` com a pergunta do usuário. Se um documento vier com "aviso" de revisão vencida, avise o usuário que o procedimento pode estar desatualizado.

Formas de conectar:
- **GPTMaker:** integração MCP nativa (passos acima). A alternativa é a API REST (`/api/integracao/*`) numa intenção ou webhook.
- **n8n:** no workflow, adicione o nó **MCP Client Tool** apontando para `/mcp`, com *Header Auth*, e ligue-o a um nó **AI Agent**.
- **Outros clientes MCP** (Claude, ChatGPT, Cursor etc.): use a mesma URL e o mesmo token.

A plataforma precisa estar num endereço que o agente consiga acessar pela internet. Defina `PUBLIC_URL` com esse endereço para que os links devolvidos abram direto na plataforma.

## Active AI com n8n + GPTMaker

A cada pergunta, a plataforma:

1. pesquisa a base com as palavras-chave da pergunta e seleciona até 6 documentos, junto com os trechos mais relevantes de cada um. Se houver um documento aberto na tela, ele sempre entra;
2. envia um `POST` ao `N8N_WEBHOOK_URL` com este JSON:

```json
{
  "sessionId": "kb-…",
  "pergunta": "Como resolvo o erro 105?",
  "prompt": "Instruções + visão geral da base + documentos relevantes + pergunta (pronto para enviar ao agente)",
  "historico": [{ "role": "user", "content": "…" }, { "role": "assistant", "content": "…" }],
  "documento_aberto": { "id": 5, "titulo": "…" },
  "documentos": [{ "id": 5, "titulo": "…", "categoria": "…", "tags": [], "link": "#/item/5", "conteudo": "trechos…" }]
}
```

3. mostra ao usuário o texto devolvido pelo n8n. A resposta pode ser texto puro ou um JSON com um destes campos: `resposta`, `output`, `message`, `text`, `response` ou `answer`. Isso inclui o JSON devolvido diretamente pelo GPTMaker.

O `sessionId` muda a cada **Nova conversa**. Use-o como `contextId` no GPTMaker para ele manter o histórico da conversa.

### Usar o workflow da Active AI que já existe

Para o workflow **Active IA — Chat hospedado no n8n**, use `N8N_WEBHOOK_URL=https://n8n.activecorp.com.br/webhook/active-ia-msg`. O nó **GPT Maker — Texto** lê `body.prompt` e `body.contextId`, e o nó **Responder ao chat** devolve `{ "message": ... }`. A plataforma envia e lê exatamente esses campos, então o workflow não precisa de nenhuma alteração.

O corpo enviado ao webhook inclui os campos que workflows prontos costumam ler: `action: "sendMessage"`, `chatInput`, `message`, `mensagem`, `text` e `sessionId`. É o mesmo formato do **Chat Trigger** do n8n. Por padrão, esses campos levam a pergunta junto com os documentos relevantes da base. Assim, o agente atual responde usando a base sem nenhuma mudança no workflow.

- `N8N_WEBHOOK_URL`: use o endereço que recebe as mensagens do chat da Active AI. Esse é o `POST` que a página chama, não necessariamente o endereço que abre a página.
- `N8N_INCLUDE_CONTEXT=false`: envia só a pergunta. Use quando o próprio agente consultar a base pela API de integração.

### Fluxo pronto para importar

O arquivo [`n8n/fluxo-base-conhecimento-gptmaker.json`](n8n/fluxo-base-conhecimento-gptmaker.json) traz o fluxo **Webhook → GPTMaker → Resposta**. Para usar:

1. No n8n, crie um workflow vazio e importe o arquivo (menu **⋯ → Import from File**).
2. No nó **Agente GPTMaker**, troque `SEU_AGENT_ID` e `SEU_TOKEN_GPTMAKER` pelos dados do seu agente.
3. Ative o workflow e copie a **Production URL** do nó **Pergunta da Base** para `N8N_WEBHOOK_URL`.

### API de integração (opcional)

Com `INTEGRATION_TOKEN` definido, o n8n pode consultar a base diretamente, por exemplo como ferramentas de um agente. Envie o header `Authorization: Bearer <INTEGRATION_TOKEN>`:

- `GET /api/integracao/buscar?q=palavras&limite=8`: pesquisa documentos.
- `GET /api/integracao/documentos/{id}`: devolve o conteúdo completo de um documento.

## Vídeos e transcrição

1. Envie o vídeo ou áudio em **Enviar arquivos**, como qualquer outro arquivo (MP4, MOV, MKV, WebM, AVI, MP3, WAV, M4A e outros).
2. Ele entra na fila de transcrição. Um vídeo por vez é processado, em partes de 5 minutos, e o progresso aparece na tela e no terminal (`[transcrição] … 40%`). Pode fechar a página; se o servidor reiniciar, a transcrição recomeça sozinha.
3. Quando termina, a transcrição aparece abaixo do player, com busca e horários clicáveis. A Active AI passa a encontrar o vídeo em `buscar_documentos` e lê a transcrição inteira em `ler_documento` (em partes, se for longa).

Como funciona:

- A transcrição roda **no próprio servidor**, com o [Whisper](https://github.com/openai/whisper) via `@huggingface/transformers` e o ffmpeg que vem com o `npm ci`. O áudio não é enviado para fora e não há custo por minuto.
- Na **primeira transcrição**, o modelo é baixado (~250 MB no `whisper-small`) e fica em cache.
- A transcrição leva mais ou menos o tempo do vídeo em um servidor comum (varia com a CPU). Um treinamento de 1 hora leva perto de 1 hora.
- Se o Teams, Meet ou Zoom já gerou a transcrição da reunião, envie o `.vtt` em **Enviar**, na tela do vídeo. É instantâneo e mantém o nome de quem fala. Também dá para **Colar** o texto.
- Com a transcrição pronta, a plataforma pede à Active AI (pelo mesmo webhook do n8n) um **resumo e os capítulos** do vídeo. Transcrições curtas vão na própria mensagem; nas longas, o agente lê a transcrição pelo MCP (`ler_documento`), então **o MCP precisa estar conectado no GPTMaker**. Se algo falhar, a tela do vídeo mostra o erro e o botão *Tentar de novo*.

### Vídeos do YouTube

1. Em **Enviar arquivos**, cole o link do vídeo em *Vídeo do YouTube* e clique em **Adicionar vídeo**. Categoria, tags e descrição preenchidas abaixo também valem para o vídeo.
2. A plataforma busca as legendas do vídeo (as feitas por pessoas têm preferência; se não houver, usa as automáticas do YouTube). Leva alguns segundos.
3. Se o vídeo não tiver legendas, abra o vídeo no YouTube, clique em *…mais* na descrição → **Mostrar transcrição**, copie o texto e cole em **Colar**, na tela do vídeo. Os horários são mantidos.

O vídeo precisa permitir incorporação (a maioria permite; vídeos "não listados" também funcionam).

## Cores (identidade visual da Active AI)

A plataforma usa a mesma paleta da Active AI: tema escuro por padrão, fundo `#0a0a0a`, painéis `#121212`, bordas `#242424` e verde `#15803d` nos destaques. Também há um tema claro com o mesmo verde. Todas as cores ficam em variáveis CSS no topo de [`public/css/styles.css`](public/css/styles.css).

## Estrutura

```
server/
  index.js    API REST (Express), upload e streaming do chat
  db.js       SQLite + índice de busca FTS5
  extract.js  Extração de texto dos arquivos
  n8n.js      Active AI via webhook do n8n (conversa livre e respostas da busca)
  mcp.js      Servidor MCP da base (ferramentas para o agente)
  transcribe.js  Transcrição de vídeos e áudios (Whisper local + ffmpeg)
  youtube.js  Vídeos do YouTube: link, título e legendas
  chapters.js Resumo e capítulos dos vídeos gerados pela Active AI
  gaps.js     Identifica respostas em que a Active AI não encontrou a informação
  ai.js       Alternativa: Active AI pela API da Anthropic
n8n/          Fluxo de exemplo para importar no n8n
public/
  index.html, css/styles.css, js/*.js   Interface (SPA sem etapa de build)
test/         Testes automatizados (npm test)
```

## Testes

```bash
npm test
```

Os testes cobrem a API, a pesquisa, o upload e a extração, as transcrições, o YouTube (simulado), as lacunas, as avaliações, o histórico de versões e as revisões. Também cobrem o ciclo de ferramentas da Active AI, usando um servidor que imita a API da Anthropic, então não é preciso ter uma chave.
