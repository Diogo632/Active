# 8. Segurança

## Proteções existentes

### Acesso

- **Senha da plataforma** (HTTP Basic, `BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`) em todas as telas e rotas `/api`. A comparação é feita em tempo constante.
- **Token de integração** (`INTEGRATION_TOKEN`) separado para o MCP e a API de integração; sem ele, essas rotas ficam desligadas.
- **Limite de tentativas**: 10 senhas ou tokens errados em 10 minutos bloqueiam o endereço (429) até a janela passar. O primeiro acesso do navegador, que vem sem senha para abrir a janela de login, não conta. Atrás de proxy, configure `TRUST_PROXY` para o bloqueio valer por pessoa e não para o proxy inteiro.
- **Avisos ao iniciar**: sem senha, senha com menos de 12 caracteres ou token curto.

### Navegador

- **CSRF**: ações (POST, PUT, DELETE em `/api`) vindas de outro site são recusadas pelo cabeçalho `Sec-Fetch-Site`. Sem isso, um site malicioso aberto por alguém logado poderia usar a senha guardada pelo navegador.
- **Política de conteúdo (CSP)** na página: só scripts da própria plataforma (nenhum script embutido no HTML), estilos e fontes do Google Fonts, vídeos do YouTube; sem plugins (`object-src 'none'`); a página não pode ser embutida em outros sites (`frame-ancestors 'self'`).
- **Cabeçalhos** em todas as respostas: `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (sem câmera, microfone, localização), `Cross-Origin-Opener-Policy`.
- **Conteúdo sanitizado**: todo texto vindo de documentos, nomes de arquivo, buscas e respostas da Active AI é escapado; o Markdown é convertido e passa pelo **DOMPurify**. Links que abrem em nova aba recebem `rel="noopener noreferrer"`.

### Arquivos

- Nome no disco gerado pelo servidor (sem caminho nem caracteres especiais).
- Só imagens, PDF, áudio/vídeo reproduzíveis e texto puro abrem no navegador; **HTML, SVG e qualquer outro tipo são sempre baixados**, com `nosniff`, para não rodarem como página da plataforma.
- Texto extraído limitado a 2 milhões de caracteres por arquivo.

### Servidor

- Consultas ao banco sempre **parametrizadas**; a busca converte o texto digitado em termos entre aspas (a sintaxe do FTS5 não pode ser injetada).
- **ffmpeg** e **yt-dlp** chamados sem shell, com argumentos em lista; o link do YouTube é reconstruído a partir do id validado.
- Erros internos não expõem detalhes (500 com mensagem genérica; detalhes só no log).
- O cabeçalho `X-Powered-By` é removido.

### Active AI

- A plataforma nunca manda o conteúdo inteiro dos documentos na mensagem; o agente lê pelo MCP com token.
- As ferramentas do MCP só leem a base, exceto `registrar_lacuna` (que só cria registros no relatório).

## Checklist para produção

1. **Senha forte** (12+ caracteres) e **token novo** (`npm run gerar-token`). Troque os valores usados nos testes e atualize o token no GPTMaker.
2. **HTTPS** obrigatório (nginx/Traefik com certificado). Com HTTP, a senha trafega sem criptografia.
3. **`TRUST_PROXY=1`** quando houver um proxy na frente.
4. **Backup** periódico de `data/` e teste de restauração.
5. **Atualizações**: `npm audit` e `npm ci` periodicamente, principalmente das bibliotecas que leem arquivos enviados (officeparser, ffmpeg) e do DOMPurify.
6. Rodar com um **usuário do sistema sem privilégios** (veja o serviço systemd em [5. Instalação](05-instalacao-e-configuracao.md#hospedar-em-produção)).
7. **Firewall**: só a porta do proxy (443) exposta; a porta da plataforma (3000) acessível apenas localmente.

## Limitações conhecidas

- **Um usuário para todos**: não há login individual, perfis (quem pode editar, quem só consulta) nem registro de quem fez cada alteração (o campo *autor* é preenchido à mão).
- **Visibilidade total**: quem tem a senha vê todos os documentos, inclusive os anexos temporários do chat (pelo link).
- **Dados para terceiros**: o conteúdo lido pela Active AI vai para o n8n e o GPTMaker. Documentos com dados pessoais de clientes devem considerar a LGPD.
- **Instruções em documentos**: um documento ou anexo pode conter texto tentando instruir o agente ("ignore as instruções…"). O impacto é limitado porque as ferramentas do agente só leem dados e registram lacunas, mas a resposta do agente pode ser influenciada.
- **Processamento de arquivos enviados**: PDFs, documentos Office e vídeos são lidos por bibliotecas de terceiros; um arquivo malicioso pode explorar falhas delas. Por isso a importância de manter as dependências atualizadas e restringir quem tem a senha.
