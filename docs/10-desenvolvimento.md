# 10. Desenvolvimento

## Tecnologias

| Camada | Tecnologia |
| --- | --- |
| Servidor | Node.js 22 (ESM), Express 5 |
| Banco | SQLite com `better-sqlite3`, busca FTS5 |
| Uploads | `multer` (disco) |
| Leitura de arquivos | `officeparser` (PDF, Office, LibreOffice, RTF, EPUB) |
| MCP | `@modelcontextprotocol/sdk` (Streamable HTTP e SSE) |
| Transcrição | `@huggingface/transformers` (Whisper) e `@ffmpeg-installer/ffmpeg` (opcionais) |
| Interface | JavaScript puro em módulos ES, sem framework nem etapa de build; `marked` + `DOMPurify` para Markdown; animações com a Web Animations API |
| Testes | `node:test` (sem dependências extras) |

## Estrutura

```text
server/
  index.js        App Express: rotas da API, uploads, integração, MCP, autenticação, inicialização
  db.js           Banco: esquema, migrações, índice FTS5 e todas as consultas (repositório)
  security.js     Cabeçalhos, CSP, bloqueio de CSRF e limite de tentativas
  n8n.js          Active AI via webhook do n8n: monta a mensagem, chama o webhook, lê a resposta
  ai.js           Alternativa: Active AI pela API da Anthropic, com ferramentas
  mcp.js          Servidor MCP (ferramentas para o agente)
  extract.js      Extração de texto dos arquivos enviados
  transcribe.js   Fila de transcrição, Whisper, ffmpeg, legendas (.vtt/.srt) e textos com horário
  youtube.js      Links, título, legendas e áudio (yt-dlp) do YouTube
  chapters.js     Resumo e capítulos dos vídeos pedidos à Active AI
  gaps.js         Detecta respostas em que a Active AI não encontrou a informação
public/
  index.html      Esqueleto da página
  css/styles.css  Todo o visual (tema escuro/claro em variáveis CSS no topo)
  js/
    app.js        Roteador (#/…), menu, painel da Active AI, tema, atalhos globais
    views.js      Telas: início, lista, documento, editor, envio, categorias, relatório
    chat.js       Chat da Active AI (estado compartilhado entre painel e página)
    answer.js     Resposta da Active AI na busca
    media.js      Player, transcrição, capítulos e ícones de vídeo
    feedback.js   "Isso ajudou?" de documentos e respostas
    templates.js  Modelos de texto e rascunhos
    options.js    Opções em botões a partir do texto do agente
    palette.js    Busca rápida (Ctrl+K)
    motion.js     Animações
    api.js        Chamadas à API
    util.js       Ícones, Markdown, datas, diálogos, armazenamento local
    theme-init.js Aplica o tema salvo antes da página aparecer
scripts/testar-mcp.js   Teste do MCP pela linha de comando (npm run mcp:testar)
n8n/                    Exemplo de workflow, nó que remove o rascunho <analise> e trecho de prompt do agente
test/                   Testes automatizados
docs/                   Esta documentação
```

## Comandos

| Comando | O que faz |
| --- | --- |
| `npm start` | Inicia a plataforma |
| `npm run dev` | Inicia e reinicia ao salvar arquivos |
| `npm test` | Roda todos os testes |
| `npm run mcp:testar -- [url] [token] [palavra]` | Testa o MCP como um agente faria |
| `npm run gerar-token` | Gera um token aleatório para o `INTEGRATION_TOKEN` |

## Testes

```bash
npm test
```

| Arquivo | Cobre |
| --- | --- |
| `test/app.test.js` | API, categorias, textos, upload e extração, busca, integração, MCP (os dois transportes), Active AI pela Anthropic (com servidor simulado) |
| `test/n8n.test.js` | Mensagem para o agente (limite de tamanho, modos), leitura das respostas e opções |
| `test/options.test.js` | Opções em botões |
| `test/transcribe.test.js` | Formatação de transcrição, legendas, transcrição em segundo plano com ffmpeg real e motor simulado |
| `test/melhorias.test.js` | Versões, revisão, lacunas, avaliações, capítulos, YouTube (simulado), anexos do chat |
| `test/seguranca.test.js` | Senha, cabeçalhos, CSP, CSRF e limite de tentativas |

Os testes não acessam a internet: a Active AI, o YouTube e o motor de transcrição são simulados com objetos passados para `createApp({ ai, youtubeClient, transcriptionEngine })`.

## Como estender

### Nova ferramenta no MCP

Em `server/mcp.js`, dentro de `buildServer()`:

```js
server.registerTool(
  'nome_da_ferramenta',
  {
    title: 'Título',
    description: 'Quando o agente deve usar e o que ela devolve.',
    inputSchema: { parametro: z.string().describe('…') },
    annotations: { readOnlyHint: true },
  },
  async ({ parametro }) => {
    log(`nome_da_ferramenta "${parametro}"`);
    return text({ resultado: '…' });
  },
);
```

Atualize a lista esperada em `test/app.test.js`, documente em [3. Active AI](03-active-ai-e-integracoes.md#ferramentas) e reconecte o MCP no GPTMaker.

### Nova coluna no banco

Em `server/db.js`, acrescente em `NEW_COLUMNS` (a migração cria a coluna nos bancos existentes), inclua em `ITEM_COLUMNS` se ela deve sair na API e trate em `createItem`/`updateItem`.

### Nova tela

Crie a função da tela em `public/js/views.js` (recebe o elemento da página e `{ params, query }`, e pode devolver uma função de limpeza), registre a rota em `routes` no `public/js/app.js` e, se for o caso, o link no menu em `public/index.html`.

## Convenções

- Textos da interface, mensagens de erro, logs e comentários em **português**.
- A interface escapa todo texto com `esc()` e renderiza Markdown só com `renderMarkdown()` (DOMPurify).
- Nada de scripts embutidos no HTML (a CSP bloqueia).
- O agente do GPTMaker vê ~4.000 caracteres por mensagem: conteúdo grande vai pelo MCP, nunca na mensagem.
