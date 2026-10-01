# 5. Instalação, configuração e hospedagem

- [Requisitos](#requisitos)
- [Rodar localmente](#rodar-localmente)
- [Variáveis de configuração (.env)](#variáveis-de-configuração-env)
- [Testar pelo GitHub Codespaces](#testar-pelo-github-codespaces)
- [Hospedar em produção](#hospedar-em-produção)
- [Atualizar a plataforma](#atualizar-a-plataforma)
- [Backup e restauração](#backup-e-restauração)

---

## Requisitos

| Item | Detalhe |
| --- | --- |
| **Node.js** | 20 ou mais novo (recomendado **22**) |
| **Sistema** | Linux (recomendado), Windows ou macOS |
| **Memória** | 1 GB para a plataforma; **+2 GB** durante transcrições com o `whisper-small` |
| **Disco** | O espaço dos arquivos e vídeos enviados + ~1 GB (dependências e modelo de transcrição) |
| **Rede de saída** | n8n (webhook), YouTube (legendas), Hugging Face (download do modelo na primeira transcrição), Google Fonts (no navegador) |
| **Rede de entrada** | A porta da plataforma, acessível pela equipe e pelo **GPTMaker** (para o MCP) |

O `npm ci` instala também o **ffmpeg** e o **Whisper** (dependências opcionais). Se a instalação delas falhar, a plataforma funciona normalmente, só sem transcrição automática.

## Rodar localmente

```bash
git clone <repositório> && cd Active
npm ci
cp .env.example .env      # e edite os valores
npm start                 # http://localhost:3000
```

Outra porta: `PORT=3001 npm start`. Modo de desenvolvimento (reinicia ao salvar arquivos): `npm run dev`.

Na inicialização, o terminal mostra o endereço, o motor da Active AI e **avisos de segurança** (sem senha, senha curta, token curto).

## Variáveis de configuração (.env)

### Básico

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `PORT` | `3000` | Porta HTTP |
| `DATA_DIR` | `./data` | Pasta do banco e dos arquivos. **Faça backup.** |
| `MAX_UPLOAD_MB` | `2048` | Tamanho máximo por arquivo enviado |
| `PUBLIC_URL` | vazio | Endereço público (ex.: `https://base.activecorp.com.br`), usado nos links que o MCP devolve |

### Acesso e segurança

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | vazio | Usuário e senha de acesso. **Obrigatório** com a porta exposta. Senha com 12+ caracteres |
| `INTEGRATION_TOKEN` | vazio | Token do MCP e da API de integração. Sem ele, o MCP fica desligado. Gere com `npm run gerar-token` |
| `TRUST_PROXY` | vazio | Atrás de nginx/Traefik, quantos proxies há na frente (ex.: `1`), para o limite de tentativas ver o IP real |

### Active AI (n8n + GPTMaker)

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `N8N_WEBHOOK_URL` | vazio | URL de produção do webhook (ex.: `https://n8n.activecorp.com.br/webhook/active-ia-msg`). Sem ela, a Active AI fica indisponível |
| `N8N_WEBHOOK_TOKEN` | vazio | Opcional: enviado como `Authorization: Bearer` |
| `N8N_TIMEOUT_SECONDS` | `240` | Espera máxima pela resposta |
| `N8N_MAX_PROMPT_CHARS` | `3500` | Tamanho máximo da mensagem enviada ao agente (o GPTMaker lê ~4.000) |
| `N8N_INCLUDE_CONTEXT` | `true` | `false`: não manda referências aos documentos na mensagem |
| `CHAPTERS` | `auto` | `off` desliga o resumo e os capítulos automáticos dos vídeos |

### Vídeos

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `TRANSCRIPTION` | `local` | `off` desliga a transcrição automática |
| `TRANSCRIPTION_MODEL` | `Xenova/whisper-small` | Modelo do Whisper |
| `TRANSCRIPTION_DTYPE` | `q8` | Precisão do modelo |
| `FFMPEG_PATH` | vazio | Caminho de um ffmpeg já instalado (por padrão usa o do `npm ci`) |
| `YTDLP_PATH` | vazio | Caminho do yt-dlp, para transcrever vídeos do YouTube sem legendas |

### Base de conhecimento

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `REVIEW_MONTHS_DEFAULT` | `6` | Prazo de revisão dos textos novos, em meses (`0` desliga) |
| `CHAT_ATTACHMENT_HOURS` | `72` | Horas que os anexos do chat ficam guardados |

### Alternativa à Anthropic

| Variável | Descrição |
| --- | --- |
| `ANTHROPIC_API_KEY` | Usa a API da Anthropic quando `N8N_WEBHOOK_URL` está vazio |
| `ACTIVE_IA_MODEL` | Modelo usado nessa alternativa |
| `ACTIVE_IA_PROVIDER` | Força `n8n` ou `anthropic` |

## Testar pelo GitHub Codespaces

Bom para testes; **não** para uso diário (veja os limites abaixo).

1. No GitHub: **Code → Codespaces → Create codespace** na branch da plataforma. O Codespace instala tudo e cria o `.env` a partir do exemplo.
2. Edite o `.env` (senha, token, `N8N_WEBHOOK_URL`, `PUBLIC_URL`).
3. Inicie em segundo plano (continua rodando se o terminal fechar):
   ```bash
   PORT=3001 nohup npm start > servidor.log 2>&1 &
   ```
4. Aba **Portas** → porta **3001** → botão direito → **Visibilidade da Porta → Pública** (necessário para o GPTMaker acessar o MCP). Abra pelo ícone de globo.
5. Para acompanhar o log: `tail -f servidor.log` (Ctrl+C sai do log sem desligar a plataforma).

Ao **reabrir** o Codespace (ele desliga sozinho após ~30 min sem uso), a plataforma precisa ser iniciada de novo e a porta conferida:

```bash
pkill -f server/index.js
PORT=3001 nohup npm start > servidor.log 2>&1 &
```

Limites do Codespace: endereço que pode mudar, porta que pode voltar para *Private*, desligamento automático, exclusão após ~30 dias sem uso, e bloqueios de serviços externos (firewall do n8n, YouTube) a endereços de datacenter.

## Hospedar em produção

Recomendado: no **servidor da Active, junto do n8n**, atrás do mesmo proxy com HTTPS.

### Com systemd (Linux)

```bash
sudo useradd -r -m -d /opt/base-conhecimento base
sudo -u base git clone <repositório> /opt/base-conhecimento/app
cd /opt/base-conhecimento/app && sudo -u base npm ci --omit=dev
sudo -u base cp .env.example .env   # edite: senha, token, n8n, PUBLIC_URL, DATA_DIR=/opt/base-conhecimento/data, TRUST_PROXY=1
```

`/etc/systemd/system/base-conhecimento.service`:

```ini
[Unit]
Description=Base de Conhecimento Active
After=network.target

[Service]
User=base
WorkingDirectory=/opt/base-conhecimento/app
ExecStart=/usr/bin/node server/index.js
Restart=always
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now base-conhecimento
journalctl -u base-conhecimento -f    # log
```

### Proxy com HTTPS (nginx)

```nginx
server {
    server_name base.activecorp.com.br;
    client_max_body_size 2048m;          # igual ao MAX_UPLOAD_MB
    proxy_read_timeout 300s;             # respostas longas da Active AI
    proxy_buffering off;                 # resposta da Active AI em tempo real (SSE)

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    # certificado: certbot --nginx -d base.activecorp.com.br
}
```

### Depois de subir

1. `PUBLIC_URL=https://base.activecorp.com.br` no `.env` e reinicie.
2. `npm run mcp:testar -- https://base.activecorp.com.br SEU_TOKEN`.
3. No GPTMaker, troque a URL do MCP para `https://base.activecorp.com.br/mcp` e reconecte.
4. Se vierem dados do Codespace, copie a pasta `data/` inteira (veja [backup](#backup-e-restauração)).

## Atualizar a plataforma

```bash
git pull
npm ci
# reinicie: systemctl restart base-conhecimento  (ou pkill + npm start no Codespace)
```

O banco é atualizado sozinho ao iniciar (as migrações são automáticas e mantêm os dados). Se o navegador mostrar a versão antiga, recarregue com **Ctrl+Shift+R**.

## Backup e restauração

Tudo fica em `DATA_DIR` (padrão `data/`):

| Caminho | Conteúdo |
| --- | --- |
| `data/base.db` (+ `base.db-wal`, `base.db-shm`) | Banco SQLite: documentos, categorias, versões, lacunas, avaliações, transcrições |
| `data/uploads/` | Os arquivos enviados |

Backup consistente sem parar a plataforma:

```bash
sqlite3 data/base.db ".backup 'backup/base-$(date +%F).db'"
rsync -a data/uploads/ backup/uploads/
```

(Sem o `sqlite3`, pare a plataforma e copie a pasta `data/` inteira.)

Restaurar: pare a plataforma, coloque o `base.db` e a pasta `uploads/` de volta em `data/` e inicie.

O modelo de transcrição fica no cache do `node_modules` e é baixado de novo se faltar; não precisa de backup.
