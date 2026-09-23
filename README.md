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

Para usar o Active IA, cadastre a chave em **GitHub → Settings → Codespaces → Secrets** com o nome `ANTHROPIC_API_KEY`, liberada para este repositório. Depois recrie ou reinicie o Codespace.

## Como rodar

Requisitos: **Node.js 20+**.

```bash
npm install
cp .env.example .env      # depois edite o .env
npm start                 # http://localhost:3000
```

Configurações do `.env`:

| Variável | Descrição |
| --- | --- |
| `ANTHROPIC_API_KEY` | Chave da API usada pelo Active IA. Sem ela, a base funciona normalmente e apenas o Active IA fica indisponível. |
| `ACTIVE_IA_MODEL` | Modelo usado pelo Active IA (padrão `claude-opus-5`). |
| `PORT` | Porta HTTP (padrão `3000`). |
| `DATA_DIR` | Pasta do banco SQLite e dos arquivos enviados (padrão `./data`). **Faça backup desta pasta.** |
| `MAX_UPLOAD_MB` | Tamanho máximo por arquivo (padrão `100`). |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | Opcional: exige usuário e senha para acessar a plataforma. |

## Cores (identidade visual do Active AI)

A plataforma usa a mesma paleta do Active AI: tema escuro por padrão, fundo `#0a0a0a`, painéis `#121212`, bordas `#242424` e verde `#15803d` nos destaques. Também há um tema claro com o mesmo verde. Todas as cores ficam em variáveis CSS no topo de [`public/css/styles.css`](public/css/styles.css).

## Estrutura

```
server/
  index.js    API REST (Express), upload e streaming do chat
  db.js       SQLite + índice de busca FTS5
  extract.js  Extração de texto dos arquivos
  ai.js       Active IA: prompt, ferramentas de acesso à base e loop de conversa
public/
  index.html, css/styles.css, js/*.js   Interface (SPA sem etapa de build)
test/         Testes automatizados (npm test)
```

## Testes

```bash
npm test
```

Os testes cobrem a API, a pesquisa, o upload e a extração. Também cobrem o ciclo de ferramentas do Active IA, usando um servidor que imita a API da Anthropic, então não é preciso ter uma chave.
