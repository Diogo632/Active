# 12. Histórico de implementações

Tudo o que foi construído na plataforma, na ordem em que entrou, com o que mudou para quem usa e onde está documentado. O detalhe técnico de cada mudança fica no histórico do Git (`git log`).

- [Resumo por área](#resumo-por-área)
- [Linha do tempo](#linha-do-tempo)
- [O que foi experimentado e retirado](#o-que-foi-experimentado-e-retirado)

---

## Resumo por área

| Área | O que a plataforma tem hoje | Documentação |
| --- | --- | --- |
| **Conteúdo** | Textos em Markdown com editor visual e modelos; arquivos de qualquer tipo com leitura do conteúdo; vídeos e áudios com transcrição automática; vídeos do YouTube com legendas | [2. Guia de uso](02-guia-de-uso.md), [4. Vídeos](04-videos-e-transcricao.md) |
| **Busca** | Busca em primeiro lugar (tela inicial e Ctrl+K), por palavras (FTS5), por sinônimos do glossário e **por significado** (modelo no próprio servidor), juntas num só resultado | [2. Guia de uso](02-guia-de-uso.md#busca), [11](11-login-busca-e-glossario.md#busca-por-significado-semântica) |
| **Active AI** | Agente do GPT Maker via n8n: resposta na busca, chat (painel, página ou fixado ao lado), documento em foco, anexos lidos pelo MCP, opções em botões, raciocínio no **!**, **base da plataforma primeiro** com aviso quando a resposta vem da base geral do GPT Maker | [3. Active AI](03-active-ai-e-integracoes.md) |
| **MCP** | 7 ferramentas para o agente: `buscar_documentos`, `ler_documento`, `listar_documentos`, `listar_categorias`, `consultar_glossario`, `registrar_lacuna`, `ver_imagem` | [3. Active AI](03-active-ai-e-integracoes.md#ferramentas) |
| **Base viva** | Relatório de lacunas, avaliações 👍👎, histórico de versões, prazo de revisão, modelos de texto, glossário | [2. Guia de uso](02-guia-de-uso.md#relatório-da-base) |
| **Acesso** | Login próprio (e-mail e senha), perfis *Administrador*, *Editor* e *Só consulta*, tela **Pessoas**, registro de quem criou e quem editou | [11](11-login-busca-e-glossario.md#login-próprio-e-mail-e-senha) |
| **Segurança** | Senhas com scrypt, sessões em cookie HttpOnly, CSP, proteção contra CSRF, limite de tentativas, arquivos perigosos sempre baixados | [8. Segurança](08-seguranca.md) |
| **Visual** | Tema escuro/claro com as cores da Active AI, esqueletos de carregamento, menu recolhível, animações, botão flutuante da Active AI | [2. Guia de uso](02-guia-de-uso.md#layout-geral) |

## Linha do tempo

### 23/09/2026 — Primeira versão

- **Base de Conhecimento do Suporte**: textos em Markdown, upload de arquivos de qualquer tipo com leitura do conteúdo (PDF, Office, LibreOffice, textos, imagens), categorias, tags e busca em texto completo (SQLite FTS5, sem diferenciar acentos).
- **Active AI integrada** e **cores da Active AI** (tema escuro `#0a0a0a` / `#121212` / `#242424`, verde `#15803d`).
- Teste pelo **GitHub Codespaces**.
- Integração com o **n8n** (agente do GPT Maker).

### 24/09/2026 — Workflow existente, MCP e busca em primeiro lugar

- Usa o **workflow da Active AI que já existia** no n8n, sem alterações (`body.prompt` + `contextId`; resposta `{ message }`), com o webhook `active-ia-msg` como padrão.
- **Servidor MCP** (`/mcp`): o agente pesquisa e lê os documentos sozinho, sem o limite de ~4.000 caracteres das mensagens do GPT Maker.
- **Redesenho com foco em busca**: a tela inicial é uma busca, com a **resposta da Active AI** no topo dos resultados e **Continuar a conversa** no chat.
- Codespace com `npm ci` (não altera o `package-lock.json`) e aviso claro quando a porta já está em uso.

### 25 e 26/09/2026 — Opções em botões e animações

- **Opções em botões** iguais às da Active AI (linha `[OPCOES] A | B | C`, listas curtas depois de uma pergunta, campo `options` do n8n).
- **Animações** com a Web Animations API, respeitando "reduzir movimento".
- HTML, JS e CSS sem cache: atualizações aparecem na hora.
- **Mensagens enxutas** para o agente (até 3.500 caracteres) e MCP compatível com o GPT Maker.
- Nome padronizado: **Active AI**.

### 26 e 27/09/2026 — Diagnóstico do MCP e vídeos

- `npm run mcp:testar`: testa o MCP como o agente faria (encontra a porta sozinho; aceita o endereço com ou sem `/mcp`).
- **Log de cada chamada ao MCP** (`[mcp http] … → 200`) e aceitação de clientes que não mandam o `Accept` exigido (caso do GPT Maker).
- **Vídeos de treinamento com transcrição automática** no próprio servidor (Whisper + ffmpeg), com horários clicáveis.

### 29/09/2026 — Base viva

- **Relatório da base**: lacunas (buscas sem resultado, respostas sem informação, 👎 e avisos do agente pelo `registrar_lacuna`), documentos para revisar e avaliações.
- **"Isso ajudou? 👍 👎"** nos documentos e nas respostas longas da Active AI.
- **Histórico de versões** dos textos, com restauração.
- **Prazo de revisão** (padrão de 6 meses) com aviso de revisão vencida, inclusive para a Active AI.
- **Modelos de texto**: *Problema → Causa → Solução*, *Passo a passo* e *Comunicado*.
- **Vídeos do YouTube**: player incorporado e transcrição pelas legendas.
- **Resumo e capítulos** dos vídeos gerados pela Active AI.
- **Anexos na conversa**: o arquivo fica guardado temporariamente (72 h) e o agente recebe só o id, lendo o conteúdo inteiro pelo MCP. *Manter na base* transforma o anexo em documento.

### 30/09/2026 — Robustez e visual

- n8n: mostra o **motivo real** de falhas de conexão e espera até **240 s** pela resposta.
- MCP: `ler_documento` aceita o id como texto (`"6"`, `"#6"`).
- **Visual**: esqueletos de carregamento, tabelas com cabeçalho e rolagem, blocos de código com **Copiar**, **menu lateral recolhível**, **Active AI fixável** ao lado do conteúdo.
- Vídeos nas listas com **ícone e duração** (vermelho no YouTube, verde nos enviados), no lugar das miniaturas.
- **Botão da Active AI**: círculo compacto com brilhos que se abre ao passar o mouse.

### 01/10/2026 — YouTube, tela inicial, segurança e documentação

- YouTube: várias formas de ler as legendas e o **motivo real** quando o YouTube bloqueia.
- **Tela inicial enxuta**: saudação conforme o horário, busca e uma lista com abas *Recentes* / *Mais acessados*.
- **Segurança**: política de conteúdo (CSP), proteção contra CSRF, limite de tentativas e avisos ao iniciar.
- **Documentação completa** em `docs/`.

### 02/10/2026 — Raciocínio, contas, busca por significado e fonte das respostas

- **Raciocínio obrigatório**: o agente escreve um rascunho `<analise>` antes de responder; a plataforma tira o rascunho do texto e mostra-o no botão **!** da mensagem. Nó do n8n (`n8n/remover-analise.js`) para o chat oficial.
- **Login próprio**: contas com e-mail e senha criadas pelo administrador em **Pessoas**, com senha provisória trocada no primeiro acesso, perfis *Administrador*, *Editor* e *Só consulta*, e `npm run admin` para recuperar o acesso. Autor e "atualizado por" vêm do login.
- **Busca por significado** com o modelo multilingual-e5 no próprio servidor (sem custo), juntada à busca por palavras.
- **Glossário da Active**: termos e sinônimos ampliam a busca e são explicados à Active AI; ferramenta MCP `consultar_glossario`.
- Transcrição do Teams em **.docx** (nome de quem fala e horário) aceita no envio de transcrição pronta.
- **Base da plataforma primeiro**: na busca e no chat, a mensagem leva a regra de fonte e os documentos encontrados. Quando a resposta vem da base geral do GPT Maker, aparece o aviso **Resposta da base geral do GPT Maker** e a pergunta vira lacuna; respostas longas sem citar documentos mostram **Sem documentos da plataforma**.

### 06/10/2026 — Prints e imagens

- **Texto das imagens lido por OCR** no próprio servidor (Tesseract, português e inglês, sem custo e sem internet): prints de erro anexados na conversa e imagens da base viram texto pesquisável. O texto curto vai direto na mensagem para o agente.
- Nova ferramenta MCP **`ver_imagem`**: entrega a própria imagem para agentes que enxergam imagens.
- Imagens enviadas antes do OCR são lidas sozinhas em segundo plano ao iniciar.

### 09/10/2026 — Ctrl+V e Codespace

- **Colar prints com Ctrl+V** no chat da Active AI: a imagem vira anexo, com miniatura e nome com data e hora, e o texto é lido na hora.
- Codespace: a plataforma **inicia sozinha** na porta 3001 ao abrir (`.devcontainer/iniciar-plataforma.sh`).
- **Resposta vazia do GPT Maker**: a plataforma tenta de novo uma vez sozinha e, se continuar vazia, explica que foi o GPT Maker.
- **Arquivos EDI** (OCOREN, NOTFIS, CONEMB, DOCCOB) e outros textos sem extensão conhecida passam a ser lidos, em UTF-8 ou ISO-8859-1.
- **Sessão expirada no chat**: em vez de "Erro 401", a plataforma leva ao login e, depois de entrar, volta para a mesma tela.

## O que foi experimentado e retirado

| Recurso | Por que saiu |
| --- | --- |
| **Miniaturas dos vídeos** nas listas | Visual poluído; trocadas pelo ícone com a duração |
| **Salvar resposta da Active AI como documento** | Retirado a pedido: as respostas não devem virar documento automaticamente |
| **Login com conta Microsoft ou Google** | Trocado pelo login próprio, com contas criadas pelo administrador (sem depender de configuração no Azure ou no Google) |
| **Senha única para toda a equipe** (HTTP Basic) | Substituída pelo login próprio |
| **Gravações do Teams pelo link do SharePoint** | O autor da gravação pode não liberar o download; volta a valer o envio do arquivo do vídeo (e da transcrição) |
