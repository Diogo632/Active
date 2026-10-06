# 7. Dados e armazenamento

Tudo o que a plataforma guarda fica em `DATA_DIR` (padrão `data/`, fora do Git):

```text
data/
├── base.db          banco SQLite (modo WAL: base.db-wal e base.db-shm acompanham)
└── uploads/         arquivos enviados, com nome gerado pelo servidor (ex.: 1727729000000-3f9a….pdf)
└── ocr/             dados de idioma do OCR (copiados dos pacotes npm; recriados se apagados)
```

O nome original do arquivo fica no banco; o nome no disco é gerado pelo servidor (data + código aleatório + extensão), então não há como um nome de arquivo malicioso gravar fora da pasta.

## Tabelas

### `items`: documentos

| Coluna | Descrição |
| --- | --- |
| `id`, `kind` | Id e tipo (`article`, `file`, `youtube`) |
| `title`, `summary`, `tags`, `category_id` | Informações (tags em texto separado por vírgula) |
| `author`, `updated_by` | Quem criou e quem fez a última alteração (nomes vindos do login) |
| `content` | Texto em Markdown (só `article`) |
| `file_name`, `stored_name`, `mime_type`, `size` | Arquivo original e nome no disco |
| `text`, `extract_status` | Texto extraído do arquivo ou transcrição (até 2 milhões de caracteres) |
| `views` | Contador de acessos |
| `media_status`, `media_progress`, `media_error`, `duration` | Transcrição de vídeo/áudio |
| `source_url` | Link do YouTube |
| `review_months`, `reviewed_at` | Prazo de revisão e última confirmação |
| `ai_summary`, `chapters`, `chapters_status`, `chapters_error` | Resumo e capítulos (JSON) gerados pela Active AI |
| `temporary`, `expires_at` | Anexo do chat e quando expira |
| `embedding_hash` | Versão do conteúdo já indexada pela busca por significado |
| `created_at`, `updated_at` | Datas (UTC) |

### `items_fts`: índice de busca

Tabela virtual **FTS5** com `title`, `tags`, `summary` e `body` (conteúdo do texto ou do arquivo + nome do arquivo + resumo e capítulos do vídeo), com o tokenizador `unicode61 remove_diacritics 2` (ignora acentos). Atualizada a cada alteração. A relevância pesa mais o título (10), depois as tags (5), a descrição (3) e o conteúdo (1).

### `categories`

`id`, `name` (único), `description`, `icon`, `created_at`.

### `item_versions`: histórico dos textos

`id`, `item_id`, `title`, `summary`, `content`, `tags`, `category_id`, `author` (quem tinha salvo aquela versão), `saved_at` (quando aquela versão tinha sido salva), `created_at`. Apagadas junto com o item.

### `gaps`: lacunas

`id`, `source` (`busca`, `ia`, `agente`, `avaliacao`), `query` (texto original), `normalized` (minúsculas, sem acentos nem pontuação, usado para agrupar), `detail`, `created_at`, `resolved_at`, `resolved_item_id`.

### `feedback`: avaliações

`id`, `target` (`documento` ou `resposta`), `item_id`, `helpful` (1/0), `comment`, `question`, `answer`, `user_name` (com o login ligado), `created_at`. Apagadas junto com o documento avaliado.

### `glossary_terms`: glossário

`id`, `term`, `synonyms` (separados por vírgula), `description`, `created_at`, `updated_at`.

### `item_chunks`: busca por significado

`item_id`, `idx`, `text` (trecho do documento com o título), `embedding` (vetor float32 de 384 posições). Recalculados quando o documento muda (`items.embedding_hash`) e apagados junto com ele. Podem ser apagados à vontade: a plataforma recalcula ao iniciar.

### `users` e `sessions`: login

`users`: `id`, `email` (único, em minúsculas), `name`, `provider` (`local`), `role` (`admin`, `editor`, `leitor`), `active`, `password_hash` (scrypt com sal: `scrypt$N$r$p$sal$hash`; a senha em si nunca é guardada), `must_change_password` (1 enquanto a pessoa usa uma senha provisória), `created_at`, `last_login_at`. `sessions`: `token_hash` (SHA-256 do cookie; o cookie em si não fica no banco), `user_id`, `created_at`, `expires_at`. Sessões vencidas são apagadas automaticamente.

## Retenção

| Dado | Quanto tempo fica |
| --- | --- |
| Documentos, arquivos, versões | Até alguém excluir (não há lixeira) |
| Anexos do chat | `CHAT_ATTACHMENT_HOURS` (padrão 72 h); a limpeza roda ao iniciar e a cada hora |
| Lacunas e avaliações | Para sempre (as resolvidas continuam no histórico) |
| Conversas do chat | No navegador de cada pessoa (últimas 40 mensagens) e no GPTMaker; a plataforma não guarda conversas |
| Pessoas | Até um administrador excluir a conta (os documentos da pessoa ficam, com o nome dela como autor) |
| Sessões de login | `SESSION_DAYS` (padrão 30 dias) sem uso; renovadas com o uso; apagadas ao sair, ao bloquear a pessoa ou ao gerar nova senha |
| Preferências (tema, menu recolhido, chat fixado, aba da tela inicial) | No navegador de cada pessoa |

## Migrações

O banco se atualiza sozinho ao iniciar: colunas e tabelas novas são criadas sem perder dados (por exemplo, as colunas de senha em `users` e `updated_by` em `items`). Bancos antigos que só aceitavam os tipos `article` e `file` são recriados aceitando `youtube`, com todos os registros copiados. Na primeira vez que a busca por significado é ligada, os documentos são indexados em segundo plano. Não há passo manual.

## O que sai da plataforma

| Para onde | O quê |
| --- | --- |
| **n8n → GPTMaker** | As perguntas, referências e trechos dos documentos, o histórico da conversa e, pelo MCP, o conteúdo completo dos documentos, transcrições e anexos que o agente ler |
| **YouTube** | Só o id dos vídeos cadastrados (para buscar título e legendas) |
| **Hugging Face** | Nada da base; só o download dos modelos de transcrição e de busca por significado na primeira vez |

O áudio dos vídeos **não** sai do servidor (a transcrição é local), a leitura do texto das imagens também é local (a imagem só vai para o agente se ele pedir pelo `ver_imagem`), e o texto dos documentos também não sai para a busca por significado (os vetores são calculados no servidor).

## Backup

Veja [5. Instalação → Backup e restauração](05-instalacao-e-configuracao.md#backup-e-restauração).
