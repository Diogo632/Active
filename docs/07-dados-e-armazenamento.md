# 7. Dados e armazenamento

Tudo o que a plataforma guarda fica em `DATA_DIR` (padrão `data/`, fora do Git):

```text
data/
├── base.db          banco SQLite (modo WAL: base.db-wal e base.db-shm acompanham)
└── uploads/         arquivos enviados, com nome gerado pelo servidor (ex.: 1727729000000-3f9a….pdf)
```

O nome original do arquivo fica no banco; o nome no disco é gerado pelo servidor (data + código aleatório + extensão), então não há como um nome de arquivo malicioso gravar fora da pasta.

## Tabelas

### `items`: documentos

| Coluna | Descrição |
| --- | --- |
| `id`, `kind` | Id e tipo (`article`, `file`, `youtube`) |
| `title`, `summary`, `tags`, `category_id`, `author` | Informações (tags em texto separado por vírgula) |
| `content` | Texto em Markdown (só `article`) |
| `file_name`, `stored_name`, `mime_type`, `size` | Arquivo original e nome no disco |
| `text`, `extract_status` | Texto extraído do arquivo ou transcrição (até 2 milhões de caracteres) |
| `views` | Contador de acessos |
| `media_status`, `media_progress`, `media_error`, `duration` | Transcrição de vídeo/áudio |
| `source_url` | Link do YouTube |
| `review_months`, `reviewed_at` | Prazo de revisão e última confirmação |
| `ai_summary`, `chapters`, `chapters_status`, `chapters_error` | Resumo e capítulos (JSON) gerados pela Active AI |
| `temporary`, `expires_at` | Anexo do chat e quando expira |
| `created_at`, `updated_at` | Datas (UTC) |

### `items_fts`: índice de busca

Tabela virtual **FTS5** com `title`, `tags`, `summary` e `body` (conteúdo do texto ou do arquivo + nome do arquivo + resumo e capítulos do vídeo), com o tokenizador `unicode61 remove_diacritics 2` (ignora acentos). Atualizada a cada alteração. A relevância pesa mais o título (10), depois as tags (5), a descrição (3) e o conteúdo (1).

### `categories`

`id`, `name` (único), `description`, `icon`, `created_at`.

### `item_versions`: histórico dos textos

`id`, `item_id`, `title`, `summary`, `content`, `tags`, `category_id`, `author`, `saved_at` (quando aquela versão tinha sido salva), `created_at`. Apagadas junto com o item.

### `gaps`: lacunas

`id`, `source` (`busca`, `ia`, `agente`, `avaliacao`), `query` (texto original), `normalized` (minúsculas, sem acentos nem pontuação, usado para agrupar), `detail`, `created_at`, `resolved_at`, `resolved_item_id`.

### `feedback`: avaliações

`id`, `target` (`documento` ou `resposta`), `item_id`, `helpful` (1/0), `comment`, `question`, `answer`, `user_name` (com o login ligado), `created_at`. Apagadas junto com o documento avaliado.

### `glossary_terms`: glossário

`id`, `term`, `synonyms` (separados por vírgula), `description`, `created_at`, `updated_at`.

### `item_chunks`: busca por significado

`item_id`, `idx`, `text` (trecho do documento com o título), `embedding` (vetor float32 de 384 posições). Recalculados quando o documento muda (`items.embedding_hash`) e apagados junto com ele. Podem ser apagados à vontade: a plataforma recalcula ao iniciar.

### `users` e `sessions`: login individual

`users`: `id`, `email`, `name`, `provider`, `role` (`admin`, `editor`, `leitor`), `active`, `created_at`, `last_login_at`. `sessions`: `token_hash` (SHA-256 do cookie; o cookie em si não fica no banco), `user_id`, `created_at`, `expires_at`. Sessões vencidas são apagadas automaticamente.

## Retenção

| Dado | Quanto tempo fica |
| --- | --- |
| Documentos, arquivos, versões | Até alguém excluir (não há lixeira) |
| Anexos do chat | `CHAT_ATTACHMENT_HOURS` (padrão 72 h); a limpeza roda ao iniciar e a cada hora |
| Lacunas e avaliações | Para sempre (as resolvidas continuam no histórico) |
| Conversas do chat | No navegador de cada pessoa (últimas 40 mensagens) e no GPTMaker; a plataforma não guarda conversas |
| Preferências (tema, menu recolhido, chat fixado, aba da tela inicial, autor) | No navegador de cada pessoa |

## Migrações

O banco se atualiza sozinho ao iniciar: colunas e tabelas novas são criadas sem perder dados. Bancos antigos que só aceitavam os tipos `article` e `file` são recriados aceitando `youtube`, com todos os registros copiados. Não há passo manual.

## O que sai da plataforma

| Para onde | O quê |
| --- | --- |
| **n8n → GPTMaker** | As perguntas, referências e trechos dos documentos, o histórico da conversa e, pelo MCP, o conteúdo completo dos documentos, transcrições e anexos que o agente ler |
| **YouTube** | Só o id dos vídeos cadastrados (para buscar título e legendas) |
| **Hugging Face** | Nada da base; só o download do modelo de transcrição na primeira vez |

O áudio dos vídeos **não** sai do servidor: a transcrição é local.

## Backup

Veja [5. Instalação → Backup e restauração](05-instalacao-e-configuracao.md#backup-e-restauração).
