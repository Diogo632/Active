# Base de Conhecimento · Suporte Active Corp

Plataforma web para a base de conhecimento do setor de Suporte da Active Corp, com o assistente **Active IA** integrado.

## Funcionalidades

- **Textos**: escreva procedimentos, soluções e comunicados direto na plataforma. O editor usa Markdown e tem barra de formatação, visualização lado a lado e atalhos (Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+S).
- **Documentos de qualquer tipo**: envie vários arquivos de uma vez, arrastando para a tela. O conteúdo é lido automaticamente para a pesquisa e para o Active IA nestes formatos:
  - PDF, Word (`.docx`), Excel (`.xlsx`), PowerPoint (`.pptx`), LibreOffice (`.odt`, `.ods`, `.odp`), RTF e EPUB
  - Textos, Markdown, CSV, JSON, XML, HTML, logs e código-fonte
  - Imagens (PNG, JPG, GIF, WebP): o Active IA consegue analisá-las visualmente

  Outros formatos (`.zip`, `.exe`, `.doc` antigo etc.) também podem ser guardados e baixados. Nesses casos o Active IA vê só o título, a descrição e as tags.
- **Visualização**: PDFs, imagens, vídeos e áudios abrem dentro da plataforma. Você pode baixar o arquivo e enviar uma nova versão.
- **Organização**: categorias com ícone, tags e descrição curta.
- **Pesquisa em texto completo**: busca em títulos, tags, descrições e conteúdo, ignorando acentos, com trechos destacados.
- **Busca em primeiro lugar**: a tela inicial é uma busca. Os resultados trazem a **resposta do Active IA** com links para os documentos, e **Ctrl+K** (ou `/`) abre a busca rápida de qualquer tela.
- **Active IA** (agente do GPTMaker, via n8n):
  - **conversa livre** no chat, usando o conhecimento próprio do agente;
  - resumos e dúvidas sobre o documento aberto;
  - **servidor MCP** para o agente pesquisar e ler a base sozinho.
- **Mais acessados**: a tela inicial mostra os documentos mais abertos pela equipe.
- **Opções de resposta em botões**, iguais às do Active AI. A plataforma usa a mesma regra da página do Active AI: a linha `[OPCOES] A | B | C` enviada pelo agente, ou as alternativas deduzidas da última pergunta. Também aceita uma lista curta depois de uma pergunta, `[[A | B]]` ou um campo `options` na resposta do n8n.
- **Animações** em JavaScript (Web Animations API): entrada das telas em cascata, mensagens do chat, revelação das respostas, botões com onda ao clicar e busca rápida animada. Tudo respeita a opção "reduzir movimento" do sistema.
- Tema claro/escuro e layout responsivo (funciona no celular).

## Testar pelo GitHub (Codespaces)

Dá para rodar a plataforma na nuvem do GitHub, sem instalar nada no computador:

1. No GitHub, abra o repositório e clique em **Code → Codespaces → Create codespace**.
2. Espere alguns minutos: o Codespace instala as dependências.
3. No terminal, rode `npm start`. Quando aparecer o aviso da porta **3000**, espere uns segundos e clique em **Open in Browser**. O endereço também aparece na aba **Ports**.

Para atualizar depois de novas versões: pare a plataforma (Ctrl+C) e rode `git pull`, `npm ci` e `npm start`.

Para usar o Active IA, cadastre o secret `N8N_WEBHOOK_URL` em **GitHub → Settings → Codespaces → Secrets**, liberado para este repositório. Depois recrie ou reinicie o Codespace.

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
| `N8N_WEBHOOK_URL` | URL de produção do webhook do n8n que responde como Active IA (ex.: fluxo com o agente do GPTMaker). Sem ela, a base funciona normalmente e só o Active IA fica indisponível. |
| `N8N_WEBHOOK_TOKEN` | Opcional: enviado como `Authorization: Bearer <token>` (configure *Header Auth* no webhook). |
| `N8N_TIMEOUT_SECONDS` | Tempo máximo de espera pela resposta (padrão `120`). |
| `INTEGRATION_TOKEN` | Opcional: libera a API de integração para o n8n consultar a base (veja abaixo). |
| `PORT` | Porta HTTP (padrão `3000`). |
| `DATA_DIR` | Pasta do banco SQLite e dos arquivos enviados (padrão `./data`). **Faça backup desta pasta.** |
| `MAX_UPLOAD_MB` | Tamanho máximo por arquivo (padrão `100`). |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | Opcional: exige usuário e senha para acessar a plataforma. |
| `ANTHROPIC_API_KEY` | Alternativa ao n8n: usa a API da Anthropic, só quando `N8N_WEBHOOK_URL` está vazio. |

## Como o Active IA funciona na plataforma

| Onde | O que é enviado ao agente | Para quê |
| --- | --- | --- |
| **Chat** (botão *Perguntar ao Active IA*) | Só a pergunta (**conversa livre**) | O agente responde com o próprio conhecimento (RAG do GPTMaker) e consulta a base pelo **MCP** quando precisa |
| **Busca** (resultados e Ctrl+K) | Pergunta + documentos encontrados | O cartão *Resposta do Active IA* resume e responde a busca com base nos documentos, com links |
| **Documento em foco** (*Perguntar ao Active IA* dentro de um documento) | Pergunta + documento inteiro | Resumos e dúvidas sobre aquele documento |

O botão **Continuar a conversa** leva a resposta da busca para o chat e mantém a mesma sessão no agente.

## Servidor MCP da Base de Conhecimento

A plataforma expõe um servidor **MCP**, usando o transporte *Streamable HTTP*, em `https://SEU_ENDERECO/mcp`. Para ativar, defina `INTEGRATION_TOKEN` no `.env`. A autenticação é pelo header `Authorization: Bearer <INTEGRATION_TOKEN>`. Para clientes que não enviam headers, também dá para usar `https://SEU_ENDERECO/mcp?token=<INTEGRATION_TOKEN>`.

Ferramentas disponíveis, todas somente leitura:

| Ferramenta | O que faz |
| --- | --- |
| `buscar_documentos` | Pesquisa em texto completo; devolve id, título, categoria, trecho e link |
| `ler_documento` | Lê o conteúdo completo de um documento (em partes de 30 mil caracteres) |
| `listar_documentos` | Lista os documentos mais recentes, opcionalmente de uma categoria |
| `listar_categorias` | Lista as categorias e quantos documentos cada uma tem |

Formas de conectar:
- **GPTMaker:** se o seu plano oferecer integração MCP, cadastre a URL `/mcp` com o token. Se não oferecer, use as mesmas funções pela API REST (`/api/integracao/*`), por exemplo em uma intenção ou webhook.
- **n8n:** no workflow, adicione o nó **MCP Client Tool** apontando para `/mcp`, com *Header Auth*, e ligue-o a um nó **AI Agent**.
- **Outros clientes MCP** (Claude, ChatGPT, Cursor etc.): use a mesma URL e o mesmo token.

A plataforma precisa estar num endereço que o agente consiga acessar pela internet. Defina `PUBLIC_URL` com esse endereço para que os links devolvidos abram direto na plataforma.

## Active IA com n8n + GPTMaker

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

### Usar o workflow do Active IA que já existe

Para o workflow **Active IA — Chat hospedado no n8n**, use `N8N_WEBHOOK_URL=https://n8n.activecorp.com.br/webhook/active-ia-msg`. O nó **GPT Maker — Texto** lê `body.prompt` e `body.contextId`, e o nó **Responder ao chat** devolve `{ "message": ... }`. A plataforma envia e lê exatamente esses campos, então o workflow não precisa de nenhuma alteração.

O corpo enviado ao webhook inclui os campos que workflows prontos costumam ler: `action: "sendMessage"`, `chatInput`, `message`, `mensagem`, `text` e `sessionId`. É o mesmo formato do **Chat Trigger** do n8n. Por padrão, esses campos levam a pergunta junto com os documentos relevantes da base. Assim, o agente atual responde usando a base sem nenhuma mudança no workflow.

- `N8N_WEBHOOK_URL`: use o endereço que recebe as mensagens do chat do Active IA. Esse é o `POST` que a página chama, não necessariamente o endereço que abre a página.
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

## Cores (identidade visual do Active AI)

A plataforma usa a mesma paleta do Active AI: tema escuro por padrão, fundo `#0a0a0a`, painéis `#121212`, bordas `#242424` e verde `#15803d` nos destaques. Também há um tema claro com o mesmo verde. Todas as cores ficam em variáveis CSS no topo de [`public/css/styles.css`](public/css/styles.css).

## Estrutura

```
server/
  index.js    API REST (Express), upload e streaming do chat
  db.js       SQLite + índice de busca FTS5
  extract.js  Extração de texto dos arquivos
  n8n.js      Active IA via webhook do n8n (conversa livre e respostas da busca)
  mcp.js      Servidor MCP da base (ferramentas para o agente)
  ai.js       Alternativa: Active IA pela API da Anthropic
n8n/          Fluxo de exemplo para importar no n8n
public/
  index.html, css/styles.css, js/*.js   Interface (SPA sem etapa de build)
test/         Testes automatizados (npm test)
```

## Testes

```bash
npm test
```

Os testes cobrem a API, a pesquisa, o upload e a extração. Também cobrem o ciclo de ferramentas do Active IA, usando um servidor que imita a API da Anthropic, então não é preciso ter uma chave.
