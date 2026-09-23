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
- **Active IA**:
  - acessa todos os documentos da base por meio de ferramentas (pesquisar, ler, listar documentos e categorias);
  - encontra documentos, responde dúvidas, resume e explica o conteúdo, sempre citando os documentos com links;
  - fica disponível em qualquer página (painel lateral) e em tela cheia (menu **Active IA**);
  - ao abrir um documento, ele entra como contexto e você pode perguntar sobre "este documento";
  - as respostas aparecem em tempo real (streaming).
- Tema claro/escuro e layout responsivo (funciona no celular).

## Testar pelo GitHub (Codespaces)

Dá para rodar a plataforma na nuvem do GitHub, sem instalar nada no computador:

1. No GitHub, abra o repositório e clique em **Code → Codespaces → Create codespace**.
2. Espere alguns minutos: o Codespace instala as dependências e inicia a plataforma sozinho.
3. Quando aparecer o aviso da porta **3000**, clique em **Open in Browser**. Ele também aparece na aba **Ports**.

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
  n8n.js      Active IA via webhook do n8n (busca na base + envio ao GPTMaker)
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
