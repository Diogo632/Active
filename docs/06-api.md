# 6. Referência da API

API HTTP usada pela interface. Todas as rotas `/api/*` (exceto `/api/integracao/*`) exigem **login** (cookie de sessão `kb_sessao`, criado em `POST /entrar`). As respostas são JSON; erros vêm como `{ "error": "mensagem" }` com o status HTTP correspondente.

Regras gerais:

- **Ações** (POST, PUT, DELETE) vindas de outro site são recusadas com **403** (proteção contra CSRF, pelo cabeçalho `Sec-Fetch-Site`). Clientes fora do navegador (scripts, n8n) não são afetados.
- **10 senhas ou tokens errados** em 10 minutos → **429** com `Retry-After`.
- Corpo JSON até 5 MB; arquivos até `MAX_UPLOAD_MB`.

- [Objeto item](#objeto-item)
- [Itens](#itens) · [Textos](#textos) · [Arquivos](#arquivos) · [YouTube](#youtube) · [Vídeos e transcrição](#vídeos-e-transcrição)
- [Versões](#versões) · [Revisão](#revisão) · [Avaliações](#avaliações) · [Relatório e lacunas](#relatório-e-lacunas)
- [Anexos do chat](#anexos-do-chat) · [Active AI](#active-ai) · [Categorias](#categorias) · [Outros](#outros)
- [Integração e MCP](#integração-e-mcp)

---

## Objeto item

| Campo | Descrição |
| --- | --- |
| `id` | Número do item |
| `kind` | `article` (texto), `file` (arquivo) ou `youtube` |
| `title`, `summary`, `tags` (lista), `author` | Informações do item |
| `category_id`, `category_name` | Categoria (ou `null`) |
| `file_name`, `mime_type`, `size` | Arquivos |
| `extract_status` | `ok`, `empty`, `unsupported`, `error` ou `media` (vídeo/áudio) |
| `views` | Quantas vezes foi aberto |
| `created_at`, `updated_at` | Datas em UTC (`AAAA-MM-DD HH:MM:SS`) |
| `media_status` | Transcrição: `pendente`, `processando`, `concluida`, `legendas` (YouTube), `manual`, `erro`, `indisponivel` |
| `media_progress`, `media_error`, `duration` | Progresso (0–100), erro e duração em segundos |
| `source_url` | Link do YouTube |
| `review_months`, `reviewed_at`, `review_due`, `review_overdue` | Prazo de revisão, última confirmação, próxima data e se venceu |
| `ai_summary`, `chapters`, `chapters_status`, `chapters_error` | Resumo e capítulos (`[{ start, title }]`); status `pendente`, `gerando`, `ok`, `erro`, `indisponivel` |
| `temporary`, `expires_at` | Anexo temporário do chat e quando expira |

## Itens

### `GET /api/items`

Lista ou pesquisa.

| Parâmetro | Descrição |
| --- | --- |
| `q` | Texto da busca (com `q`, a resposta vem por relevância e cada item tem `snippet`, com os termos entre `[[ ]]`) |
| `category` | Id da categoria ou `none` (sem categoria) |
| `kind` | `article`, `file` ou `youtube` |
| `tag` | Só itens com a tag |
| `limit`, `offset` | Paginação (limite até 200, padrão 50) |
| `sort=views` | Mais acessados primeiro |
| `revisar` | Só itens com revisão vencida |
| `registrar` | Com `q`: se não houver resultado, registra a busca como lacuna |

Resposta: `{ items: [item…], total }`. Anexos temporários nunca aparecem.

### `GET /api/items/{id}`

Um item, com `content` (textos), `text_preview` (primeiros 20.000 caracteres do texto extraído ou da transcrição), `text_length`, `feedback: { up, down }` e `versions_count`.

| Parâmetro | Descrição |
| --- | --- |
| `view` | Conta um acesso (usado ao abrir a página) |
| `full` | Inclui `text_full` (o texto inteiro) |

### `PUT /api/items/{id}`

Atualiza `title`, `summary`, `content` (só textos), `tags` (texto separado por vírgula ou lista), `category_id`, `author`, `review_months` (`''` = sem revisão). Mudanças no título, conteúdo, descrição ou tags de um texto guardam a versão anterior.

### `DELETE /api/items/{id}`

Exclui o item, o arquivo, as versões e as avaliações. Resposta 204.

### `GET /api/items/{id}/file`

O arquivo. Imagens, PDF, vídeo/áudio reproduzíveis e texto abrem no navegador; os demais tipos (inclusive HTML e SVG) sempre são baixados. `?download` força o download.

## Textos

### `POST /api/articles`

Corpo: `{ title (obrigatório), content, summary, tags, category_id, author, review_months }`. Sem `review_months`, usa `REVIEW_MONTHS_DEFAULT`. Resposta 201 com o item.

## Arquivos

### `POST /api/files`

`multipart/form-data` com um ou mais `files` (até 50) e, opcionalmente, `title` (só com um arquivo), `category_id`, `tags`, `summary`, `author`. O texto é extraído na hora; vídeos e áudios entram na fila de transcrição. Resposta 201 com a lista de itens criados.

### `PUT /api/items/{id}/file`

Nova versão do arquivo (`multipart` com `file`), mantendo título, categoria e tags.

## YouTube

### `POST /api/youtube`

Corpo: `{ url (obrigatório), title, category_id, tags, summary, author, review_months }`.

| Status | Quando |
| --- | --- |
| 201 | Criado; as legendas são buscadas em segundo plano |
| 400 | Link inválido, vídeo privado ou inexistente |
| 409 | O vídeo já está na base (`{ error, item }` com o existente) |

## Vídeos e transcrição

| Rota | Descrição |
| --- | --- |
| `POST /api/items/{id}/transcribe` | Transcreve de novo (vídeo enviado) ou busca as legendas de novo (YouTube) |
| `PUT /api/items/{id}/transcript` | Transcrição pronta: `multipart` com `file` (`.vtt`, `.srt`, `.txt`, `.docx`) ou JSON `{ text }`. Fica com `media_status: manual` |
| `POST /api/items/{id}/chapters` | Pede de novo o resumo e os capítulos à Active AI |

## Versões

| Rota | Descrição |
| --- | --- |
| `GET /api/items/{id}/versions` | `[{ id, item_id, title, author, saved_at, size }]`, da mais nova para a mais antiga |
| `GET /api/items/{id}/versions/{versionId}` | A versão completa (`title`, `summary`, `content`, `tags`, `category_id`, `author`, `saved_at`) |
| `POST /api/items/{id}/versions/{versionId}/restore` | Restaura (corpo opcional `{ author }`); a versão atual também é guardada |

## Revisão

`POST /api/items/{id}/reviewed` registra que o documento foi revisado e continua válido.

## Avaliações

### `POST /api/feedback`

| Campo | Descrição |
| --- | --- |
| `target` | `documento` ou `resposta` |
| `helpful` | `true` (👍) ou `false` (👎) |
| `item_id` | Documento avaliado (`target: documento`) |
| `question`, `answer` | Pergunta e resposta avaliadas (`target: resposta`) |
| `comment` | Comentário opcional |

Uma resposta avaliada com 👎 registra a pergunta como lacuna (origem `avaliacao`).

## Relatório e lacunas

### `GET /api/relatorio`

`{ gaps, review, feedback }`:

- `gaps`: `[{ normalized, query, count, sources, first_at, last_at, details: [{ source, detail, created_at }], resolved_at, resolved_item_id }]`. `?resolvidas` traz as resolvidas.
- `review`: itens com revisão vencida.
- `feedback`: `{ totals: { documento: { up, down }, resposta: { up, down } }, docs: [{ id, title, up, down, comments }], answers: [{ id, question, answer, comment, created_at }] }`.

| Rota | Corpo |
| --- | --- |
| `POST /api/lacunas/resolver` | `{ pergunta, item_id? }` (resolve todas as lacunas com a mesma pergunta normalizada) |
| `POST /api/lacunas/reabrir` | `{ pergunta }` |

## Anexos do chat

| Rota | Descrição |
| --- | --- |
| `POST /api/chat/anexos` | `multipart` com `file`. Cria um item temporário (expira em `CHAT_ATTACHMENT_HOURS`) e devolve o item com `text_length` |
| `POST /api/items/{id}/keep` | Transforma o anexo em documento permanente |

## Active AI

### `POST /api/ai/chat`

Corpo:

| Campo | Descrição |
| --- | --- |
| `messages` | Conversa `[{ role: 'user' \| 'assistant', content }]` (últimas 30 mensagens, até 20.000 caracteres cada) |
| `mode` | `livre` (chat) ou `base` (resposta da busca) |
| `session_id` | Id da conversa (vai como `contextId` ao n8n) |
| `context_item_id` | Documento em foco |
| `attachments` | Ids dos anexos desta mensagem (até 10) |

Resposta em **Server-Sent Events** (`text/event-stream`), um evento por linha `data: {json}`:

| `type` | Campos | Significado |
| --- | --- | --- |
| `status` | `label` | Etapa ("Pesquisando documentos na base", "Consultando a Active AI") |
| `text` | `text` | Texto da resposta |
| `options` | `items` | Opções em botões |
| `sources` | `items: [{ id, title, kind }]` | Documentos usados |
| `analysis` | `text` | Rascunho de raciocínio do agente (mostrado só ao clicar no **!**) |
| `error` | `message` | Erro legível |
| `done` | | Fim |

## Categorias

| Rota | Descrição |
| --- | --- |
| `GET /api/categories` | `[{ id, name, description, icon, created_at, item_count }]` |
| `POST /api/categories` | `{ name, description, icon }` → 201 (409 se o nome já existe) |
| `PUT /api/categories/{id}` | Atualiza nome, descrição ou ícone |
| `DELETE /api/categories/{id}` | Exclui (os documentos ficam sem categoria) |

## Outros

| Rota | Descrição |
| --- | --- |
| `GET /api/stats` | `{ total, articles, files, bytes, categories, gaps_open, review_due, ai: { configured, provider, model }, transcription: { enabled, model }, chapters: { enabled }, semantic: { enabled, ready, model, indexed, pending, error }, auth: { enabled }, review_months_default }` |
| `GET /api/tags` | `[{ name, count }]` |

## Pessoa logada, perfis e glossário

| Rota | Perfil | Descrição |
| --- | --- | --- |
| `GET /api/me` | todos | `{ user: { id, email, name, role } \| null, auth: { enabled, roles } }` |
| `GET /api/usuarios` | admin | `[{ id, email, name, role, active, must_change_password, created_at, last_login_at }]` |
| `POST /api/usuarios` | admin | `{ name, email, role }` → 201 `{ user, password }` (senha provisória, mostrada só aqui) |
| `PUT /api/usuarios/{id}` | admin | `{ name?, email?, role?: "admin" \| "editor" \| "leitor", active?: boolean }`. Bloquear encerra as sessões da pessoa |
| `POST /api/usuarios/{id}/senha` | admin | Gera nova senha provisória → `{ password }` e encerra as sessões da pessoa |
| `DELETE /api/usuarios/{id}` | admin | Exclui a conta → 204 |
| `GET /api/glossario` | todos | `[{ id, term, synonyms: [], description, created_at, updated_at }]` |
| `POST /api/glossario` | editor | `{ term, synonyms: "a, b" \| ["a","b"], description }` → 201 |
| `PUT /api/glossario/{id}` | editor | Mesmos campos, todos opcionais |
| `DELETE /api/glossario/{id}` | editor | 204 |
| `GET /entrar` · `POST /entrar` | — | Página de login (formulário `email`, `senha`, `volta`). Sem nenhuma conta, mostra o *Primeiro acesso* |
| `POST /primeiro-acesso` | — | Cria o administrador (`nome`, `email`, `senha`, `confirmacao`); só funciona enquanto não houver conta |
| `GET /trocar-senha` · `POST /trocar-senha` | logado | Troca a senha (`atual`, `senha`, `confirmacao`); obrigatória depois de uma senha provisória |
| `POST /auth/sair` | — | Encerra a sessão → `{ ok, login }` |

Chamadas sem sessão recebem `401 { error, login: "/entrar" }` (ou `login: "/trocar-senha"` enquanto a pessoa não criar a senha), e alterações que o perfil não permite recebem `403`. *Só consulta* pode usar `POST /api/feedback`, `POST /api/chat/anexos` e `POST /api/ai/chat`. Os campos `author` (na criação) e `updated_by` vêm da pessoa logada; o `author` enviado pelo cliente é ignorado.

Resultados de busca (`GET /api/items?q=`) achados só pelo significado vêm com `by_meaning: true` e o trecho mais parecido em `snippet`.

## Integração e MCP

Protegidos pelo `INTEGRATION_TOKEN` (não pelo login). Detalhes em [3. Active AI e integrações](03-active-ai-e-integracoes.md).

| Rota | Descrição |
| --- | --- |
| `GET /api/integracao/buscar?q=&limite=` | Busca (somente leitura) |
| `GET /api/integracao/documentos/{id}` | Documento completo |
| `POST /mcp` | Servidor MCP (Streamable HTTP) |
| `GET /mcp/sse`, `POST /mcp/messages` | Servidor MCP (SSE) |
