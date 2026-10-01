# 4. Vídeos, transcrição e YouTube

Vídeos e áudios (treinamentos com clientes, reuniões, gravações de tela) entram na base como qualquer documento. A **transcrição** vira o conteúdo do item: é ela que a busca encontra e que a Active AI lê para responder sobre o vídeo.

## Formatos e limites

| | |
| --- | --- |
| Vídeo | `.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`, `.wmv`, `.m4v`, `.mpg`, `.mpeg` |
| Áudio | `.mp3`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.oga`, `.opus`, `.flac`, `.wma` |
| Tamanho máximo | 2 GB por arquivo (`MAX_UPLOAD_MB`) |
| Toca no navegador | MP4, WebM e OGG (vídeo); MP3, WAV, OGG, M4A, AAC, FLAC (áudio). Os outros formatos são transcritos normalmente, mas para assistir é preciso baixar |

## Transcrição automática (vídeos enviados)

1. Ao enviar, o vídeo entra na **fila de transcrição**. Um vídeo por vez é processado, em segundo plano.
2. O **ffmpeg** extrai o áudio em partes de **5 minutos** (mono, 16 kHz).
3. O **Whisper** (modelo `Xenova/whisper-small` por padrão, via `@huggingface/transformers`) transcreve cada parte **no próprio servidor**. O áudio não sai do servidor e não há custo por minuto.
4. O texto é agrupado em parágrafos de ~30 segundos com o horário de início: `[00:12:34] texto…`.
5. Ao terminar, a plataforma pede o [resumo e os capítulos](#resumo-e-capítulos) à Active AI.

Acompanhamento:

- Na tela do vídeo: *Na fila* → *Transcrevendo… 40%* com barra de progresso. Pode sair da página.
- No log do servidor: `[transcrição] Iniciando #10 "Treinamento" (00:45:12)`, `… 40%`, `Concluída`.
- Se o servidor reiniciar no meio, a transcrição **recomeça sozinha**.

Desempenho:

- Na **primeira transcrição**, o modelo é baixado (~250 MB no `whisper-small`) e fica em cache.
- Num servidor comum, leva mais ou menos **o tempo do vídeo** (1 hora de vídeo ≈ 1 hora). Varia com a CPU.
- Modelos (`TRANSCRIPTION_MODEL`): `Xenova/whisper-base` (mais rápido, menos preciso), `Xenova/whisper-small` (padrão), `Xenova/whisper-medium` (mais preciso, mais lento). Precisão em `TRANSCRIPTION_DTYPE` (padrão `q8`).
- `TRANSCRIPTION=off` desliga a transcrição automática (sobra a transcrição enviada ou colada).

## Vídeos do YouTube

1. Em *Enviar arquivos → Vídeo do YouTube*, cole o link e clique em **Adicionar vídeo**. Aceita `watch?v=`, `youtu.be/`, `shorts/`, `embed/` e `live/`.
2. Título e canal vêm do YouTube (o canal vira o autor, se o campo estiver vazio).
3. A plataforma busca as **legendas do próprio YouTube**: feitas por pessoas em português primeiro; depois automáticas em português; depois outros idiomas. Leva segundos.
4. O vídeo **toca dentro da plataforma** (player incorporado `youtube-nocookie.com`), e clicar num horário da transcrição leva o player até lá.

Requisitos e limitações:

- O vídeo precisa permitir **incorporação**. Vídeos privados são recusados; "não listados" funcionam.
- O mesmo vídeo não entra duas vezes.
- O YouTube às vezes **bloqueia** a leitura das legendas a partir de servidores de nuvem (como o Codespace), pedindo login para "confirmar que não é um robô". A plataforma tenta quatro formas (apps Android e iPhone, player incorporado e página do vídeo) e, se todas forem bloqueadas, avisa isso na tela. O motivo detalhado de cada tentativa fica no log: `[transcrição] Legendas de #10 … não lidas (bloqueado): ANDROID: LOGIN_REQUIRED (…) | IOS: …`.
- **Sem legendas** (ou bloqueado), há duas saídas:
  - **Colar a transcrição** (sempre funciona): no YouTube, *…mais* na descrição → **Mostrar transcrição** → copiar o texto do painel → **Colar** na tela do vídeo. Os horários são mantidos; linhas como "1 minuto e 5 segundos" são ignoradas.
  - **yt-dlp** (opcional, no servidor): com o [yt-dlp](https://github.com/yt-dlp/yt-dlp) instalado (`YTDLP_PATH`), a plataforma baixa só o áudio e transcreve com o Whisper.

## Enviar ou colar uma transcrição pronta

Na tela de qualquer vídeo, no painel *Transcrição*:

- **Enviar**: arquivo `.vtt` ou `.srt` (o Teams, o Meet e o Zoom geram), `.txt` ou `.docx`. Legendas `.vtt` mantêm o nome de quem fala (`Ana: Bom dia…`).
- **Colar**: texto com horários (`0:05` numa linha e o texto na seguinte, ou `0:05 texto`, ou `[00:00:05] texto`) ou texto livre (fica sem horários).

A transcrição enviada **substitui** a automática e também gera resumo e capítulos.

## A tela do vídeo

- **Player** no topo.
- **Resumo e capítulos** (gerados pela Active AI): um parágrafo de resumo e a lista de capítulos (`0:40 Cadastro do cliente`). Clicar leva o vídeo ao ponto; o capítulo que está tocando fica destacado.
- **Transcrição**: busca dentro do texto, horários clicáveis e o trecho que está tocando destacado.
- Botões: **Colar**, **Enviar**, **↻** (transcrever de novo / buscar legendas de novo).

## Resumo e capítulos

Quando a transcrição fica pronta, a plataforma pede ao agente, pelo webhook do n8n:

```text
RESUMO: <de 2 a 4 frases sobre o que o vídeo ensina>
CAPITULOS:
[hh:mm:ss] <assunto em poucas palavras>
```

- De 3 a 12 capítulos, na ordem; horários além da duração do vídeo são descartados.
- Transcrições curtas vão na própria mensagem. Nas longas (que não cabem em ~3.400 caracteres), o agente lê a transcrição pelo MCP, então **o MCP precisa estar conectado no GPTMaker**.
- Se a resposta não vier no formato, a tela mostra o erro e o botão **Tentar de novo**.
- O resumo e os títulos dos capítulos também entram na busca e são entregues ao agente no `ler_documento`.
- `CHAPTERS=off` desliga.

## Como a Active AI usa o vídeo

- `buscar_documentos` encontra o vídeo pela transcrição, pelo resumo ou pelos capítulos.
- `ler_documento` entrega a transcrição completa com os horários, a duração, o resumo, os capítulos e o link do YouTube. O agente é orientado a **citar o minuto** ao responder.
- Na página do vídeo, *Resumir com a Active AI* pede um resumo em tópicos com os horários de cada assunto.
