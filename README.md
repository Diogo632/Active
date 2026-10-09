# Base de Conhecimento · Suporte Active Corp

Plataforma web da base de conhecimento do Suporte da Active Corp, com a assistente **Active AI** integrada: o agente do GPT Maker, chamado pelo n8n, que consulta a base pelo **MCP**.

> 📘 **Documentação completa em [`docs/`](docs/README.md)**: guia de uso, Active AI e MCP, vídeos, instalação e hospedagem, API, dados, segurança, solução de problemas, desenvolvimento, login/busca por significado/glossário e o [histórico de implementações](docs/12-historico-de-implementacoes.md).

## Funcionalidades

### Conteúdo

- **Textos** escritos na plataforma, em Markdown, com barra de formatação, visualização lado a lado, atalhos (Ctrl+B, Ctrl+I, Ctrl+K, Ctrl+S) e **modelos** (*Problema → Causa → Solução*, *Passo a passo*, *Comunicado*).
- **Arquivos de qualquer tipo**, vários de uma vez, arrastando para a tela. O conteúdo é lido para a busca e para a Active AI em PDF, Word, Excel, PowerPoint, LibreOffice, RTF, EPUB, textos, CSV, JSON, XML, HTML, logs, código e **imagens** (texto lido por OCR). Outros formatos são guardados e podem ser baixados.
- **Vídeos e áudios** (treinamentos, reuniões) **transcritos automaticamente** no próprio servidor (Whisper + ffmpeg, sem custo). A transcrição tem horários clicáveis e entra na busca. Também dá para enviar a transcrição pronta (`.vtt`/`.srt` do Teams, Meet ou Zoom, `.txt` ou o `.docx` do Teams).
- **Vídeos do YouTube**: o vídeo toca na plataforma e a transcrição vem das legendas do YouTube.
- **Resumo e capítulos** dos vídeos, gerados pela Active AI ("0:40 Cadastro do cliente · 1:15 Transmissão para a SEFAZ").
- Visualização de PDFs, imagens, vídeos e áudios na própria página; download e envio de nova versão.
- **Categorias** com ícone, **tags** e descrição curta.

### Busca

- **Busca em primeiro lugar**: a tela inicial é uma busca, e **Ctrl+K** (ou `/`) abre a busca rápida em qualquer tela.
- **Por palavras** (títulos, tags, descrições, conteúdo, transcrições e capítulos), ignorando acentos, com os termos destacados.
- **Por significado**: encontra o documento pelo assunto, mesmo sem as mesmas palavras ("cliente não consegue tirar nota" acha "Erro na emissão de NF-e"). O modelo roda no próprio servidor; os resultados achados assim têm a etiqueta **≈ significado**.
- **Glossário da Active** (menu *Glossário*): termos, siglas e sinônimos. Quem procura por um sinônimo encontra os documentos que usam o termo.

### Active AI

- **Resposta da Active AI** no topo dos resultados da busca, com **Continuar a conversa** no chat.
- **Chat** como painel lateral, página inteira ou **fixado ao lado** do conteúdo.
- **Base da plataforma primeiro**: cada mensagem leva a regra de fonte e os documentos encontrados. Se a resposta vier da base geral do GPT Maker, a mensagem mostra o aviso **Resposta da base geral do GPT Maker** e a pergunta vira lacuna. Respostas longas sem citar documentos mostram **Sem documentos da plataforma**.
- **Documento em foco**: *Perguntar à Active AI* e *Resumir com a Active AI* na página de um documento.
- **Anexos na conversa** (📎, arrastando ou **Ctrl+V com um print**): o arquivo fica guardado por 72 horas e o agente lê o conteúdo inteiro pelo MCP.
- **Opções em botões** (`[OPCOES] A | B | C`), **raciocínio** do agente no botão **!** e **Ajudou? 👍 👎** nas respostas longas.
- **Prints e imagens**: o texto das imagens (mensagens de erro, telas de sistema) é lido no próprio servidor (OCR, sem custo), entra na busca e vai para o agente; a imagem em si também pode ser vista pelo agente (`ver_imagem`).
- **Servidor MCP** com 7 ferramentas para o agente pesquisar e ler a base sozinho.

### Base viva

- **Relatório** (menu *Relatório*): **lacunas** (o que foi procurado e não encontrado, agrupado por frequência), documentos **para revisar** e **avaliações**.
- **Isso ajudou? 👍 👎** no fim de cada documento.
- **Histórico de versões** dos textos, com restauração.
- **Prazo de revisão** (padrão de 6 meses): passado o prazo, o documento mostra o aviso e a Active AI avisa quem pergunta.

### Acesso

- **Login próprio** (e-mail e senha). No **primeiro acesso**, a plataforma pede para criar o administrador; ele cria as contas da equipe em **Pessoas**, com uma senha provisória que a pessoa troca no primeiro login.
- Perfis **Administrador**, **Editor** e **Só consulta** (os botões de edição somem para quem só consulta, e o servidor bloqueia).
- A plataforma registra **quem criou e quem editou** cada documento.

### Visual

- Tema escuro (padrão) e claro com as cores da Active AI; layout responsivo.
- Esqueletos de carregamento, tabelas com rolagem, blocos de código com **Copiar**, menu lateral recolhível, vídeos com ícone e duração, botão flutuante da Active AI e animações que respeitam "reduzir movimento".

## Como rodar

Requisitos: **Node.js 20+** (recomendado 22).

```bash
npm ci
cp .env.example .env      # edite N8N_WEBHOOK_URL, INTEGRATION_TOKEN e PUBLIC_URL
npm start                 # http://localhost:3000
```

Na primeira vez, abra o endereço e **crie o administrador** (*Primeiro acesso*). Enquanto não houver conta, quem abrir o endereço primeiro cria o administrador. Pelo terminal: `npm run admin -- seu@email.com.br "Seu Nome"` (também recupera o acesso se o administrador esquecer a senha).

Principais variáveis do `.env` (a lista completa está em [docs/05](docs/05-instalacao-e-configuracao.md#variáveis-de-configuração-env)):

| Variável | Descrição |
| --- | --- |
| `N8N_WEBHOOK_URL` | Webhook do n8n que responde como Active AI (`https://n8n.activecorp.com.br/webhook/active-ia-msg`) |
| `INTEGRATION_TOKEN` | Token do MCP e da API de integração (`npm run gerar-token`). Sem ele, o MCP fica desligado |
| `PUBLIC_URL` | Endereço público da plataforma (links do MCP e cookie seguro em HTTPS) |
| `PORT` / `DATA_DIR` | Porta (padrão `3000`) e pasta dos dados (padrão `./data`, **faça backup**) |
| `TRANSCRIPTION` / `SEMANTIC_SEARCH` / `OCR` | `off` desliga a transcrição automática / a busca por significado / a leitura de texto das imagens |
| `SEMANTIC_MIN_SCORE` | Nota mínima da busca por significado (padrão `0.8`) |
| `SESSION_DAYS` | Dias até a pessoa precisar entrar de novo (padrão `30`) |
| `TRUST_PROXY` | Atrás de um proxy (nginx), quantos há na frente (ex.: `1`) |

### Testar pelo GitHub Codespaces

1. **Code → Codespaces → Create codespace** na branch da plataforma.
2. Edite o `.env` e inicie em segundo plano: `PORT=3001 nohup npm start > servidor.log 2>&1 &`.
3. Aba **Portas** → 3001 → **Visibilidade → Pública** e abra pelo globo. Se o endereço do Codespace der **404** mesmo com a plataforma no ar, use um túnel: `npx -y cloudflared tunnel --url http://localhost:3001` e abra o endereço `https://….trycloudflare.com` que aparecer.
4. Crie o administrador logo ao abrir.

Detalhes, limites do Codespace e hospedagem em produção (systemd + nginx com HTTPS) em [docs/05](docs/05-instalacao-e-configuracao.md).

## Como a Active AI funciona

```text
Pessoa → Plataforma ──(webhook: regra de fonte + documentos encontrados + pergunta, até 3.500 caracteres)──→ n8n → Agente GPT Maker
                 ↑                                                                                                     │
                 └─────────────────────────────(MCP: buscar_documentos, ler_documento…)───────────────────────────────┘
```

- A mensagem tem **no máximo 3.500 caracteres**, porque o GPT Maker só enxerga cerca de 4.000 por mensagem. O conteúdo completo dos documentos nunca vai na mensagem: o agente lê pelo **MCP**.
- O workflow da Active AI no n8n não precisa de alteração: a plataforma envia `prompt` e `contextId` e lê `{ message }`.
- No GPT Maker, conecte o MCP (`https://ENDERECO/mcp`, cabeçalho `Authorization: Bearer <INTEGRATION_TOKEN>`) e acrescente às instruções do agente o [prompt recomendado](docs/03-active-ai-e-integracoes.md#prompt-recomendado-para-o-agente), que inclui a regra da base da plataforma primeiro e a marcação `[FONTE: BASE GERAL]`.

Ferramentas do MCP:

| Ferramenta | O que faz |
| --- | --- |
| `buscar_documentos` | Busca por palavras, sinônimos do glossário e significado; devolve id, título, trecho, link e avisos |
| `ler_documento` | Lê o conteúdo completo (em partes de 30 mil caracteres); em vídeos, a transcrição, o resumo e os capítulos |
| `listar_documentos` | Lista os documentos mais recentes, opcionalmente de uma categoria |
| `listar_categorias` | Lista as categorias e quantos documentos cada uma tem |
| `consultar_glossario` | Explica termos, siglas e nomes internos da Active |
| `registrar_lacuna` | Registra uma pergunta que a base não respondeu (vai para o relatório) |
| `ver_imagem` | Devolve a própria imagem (prints, fotos) para agentes que enxergam imagens |

Configuração completa, formato das mensagens, raciocínio obrigatório e solução de problemas em [docs/03](docs/03-active-ai-e-integracoes.md) e [docs/09](docs/09-solucao-de-problemas.md).

## Segurança

- **Login próprio** com senhas guardadas com scrypt, senha provisória trocada no primeiro acesso, sessões em cookie HttpOnly e perfis verificados no servidor.
- **Limite de tentativas** (10 senhas ou tokens errados em 10 minutos), **proteção contra CSRF**, **CSP** e cabeçalhos de segurança.
- Conteúdo sanitizado (escape e DOMPurify); HTML, SVG e outros tipos perigosos são sempre baixados, nunca abertos.
- MCP e API de integração só com o `INTEGRATION_TOKEN`; consultas ao banco parametrizadas; ffmpeg e yt-dlp sem shell.

Antes de colocar em produção: crie o administrador, gere um **token novo**, use **HTTPS**, faça **backup** da pasta `data/` e mantenha as dependências atualizadas. O conteúdo que a Active AI lê vai para o **n8n e o GPT Maker** (atenção à LGPD). Checklist completo em [docs/08](docs/08-seguranca.md).

## Estrutura

```text
server/       Servidor (Express): API, login, banco SQLite, busca, Active AI (n8n), MCP, transcrição, YouTube
public/       Interface (JavaScript puro, sem etapa de build)
scripts/      npm run mcp:testar e npm run admin
n8n/          Fluxo de exemplo, nó que remove o rascunho <analise> e trecho de prompt do agente
test/         Testes automatizados (npm test)
docs/         Documentação
```

Detalhes de cada arquivo em [docs/10](docs/10-desenvolvimento.md).

## Testes

```bash
npm test
```

Cobrem a API, a busca (palavras, glossário e significado), uploads, transcrições, YouTube, lacunas, avaliações, versões, revisões, login e perfis, segurança, o MCP e a conversa com o n8n. A Active AI, o YouTube, a transcrição e o modelo de vetores são simulados: os testes não acessam a internet.
