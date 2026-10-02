# 2. Guia de uso

Este guia cobre todas as telas da plataforma, na ordem em que aparecem no menu.

- [Acesso](#acesso)
- [Layout geral](#layout-geral)
- [Tela inicial](#tela-inicial)
- [Busca](#busca)
- [Lista de documentos](#lista-de-documentos)
- [Página de um documento](#página-de-um-documento)
- [Escrever e editar textos](#escrever-e-editar-textos)
- [Enviar arquivos e vídeos](#enviar-arquivos-e-vídeos)
- [Active AI](#active-ai)
- [Anexar arquivos na conversa](#anexar-arquivos-na-conversa)
- [Relatório da base](#relatório-da-base)
- [Categorias](#categorias)
- [Glossário](#glossário) e [busca por significado](#busca-por-significado)
- [Atalhos de teclado](#atalhos-de-teclado)

---

## Acesso

Abra o endereço da plataforma no navegador.

Entre com o seu **e-mail e senha**. A conta é criada por um administrador, que passa uma **senha provisória**; no primeiro acesso, a plataforma pede para você criar a sua senha (mínimo 10 caracteres).

Seu nome e perfil aparecem no rodapé do menu, com os botões **Trocar senha** (chave) e **Sair**. O que você cria e edita fica registrado no seu nome. Esqueceu a senha? Peça a um administrador uma nova senha provisória.

Administradores gerenciam as contas no menu **Pessoas** (criar, mudar perfil, bloquear, gerar senha provisória, excluir).

### Perfis

| Perfil | O que pode fazer |
| --- | --- |
| **Administrador** | Tudo, mais a tela **Pessoas** (mudar perfis e bloquear acessos) |
| **Editor** | Criar, editar e excluir documentos, categorias e termos do glossário |
| **Só consulta** | Pesquisar, ler, baixar, conversar com a Active AI e avaliar. Os botões de edição não aparecem |

## Glossário

Menu **Glossário**: termos, siglas e sinônimos da Active (ex.: **CT-e** = *CTe, conhecimento de transporte*). Quem pesquisar por um sinônimo encontra os documentos que usam o termo, e a Active AI recebe a explicação dos termos citados na pergunta. Use o filtro para achar um termo; Editores usam **Novo termo** e os ícones de editar e excluir.

## Busca por significado

A busca encontra documentos pelo assunto, mesmo sem as mesmas palavras: "cliente não consegue tirar nota" acha "Erro na emissão de NF-e". Os documentos achados assim aparecem com a etiqueta **≈ significado** e mostram o trecho mais parecido com a pergunta.

## Layout geral

- **Menu lateral** (esquerda): Início, Todos os documentos, Active AI, Relatório, os botões *Escrever texto* e *Enviar arquivos*, e a lista de **categorias** com a quantidade de documentos.
  - O botão no canto superior esquerdo **recolhe o menu** (fica só com os ícones; passe o mouse para ver o nome). A escolha fica salva. Em telas menores que 1280 px ele já começa recolhido. No celular, o mesmo botão abre o menu por cima da tela.
  - O número verde ao lado de **Relatório** soma as lacunas abertas e os documentos com revisão vencida.
  - No rodapé do menu: **Tema claro / Tema escuro** (o escuro é o padrão, igual à Active AI).
- **Barra superior**: a **busca rápida** (Ctrl+K). Na tela inicial ela fica escondida, porque a busca principal já está no centro.
- **Botão da Active AI** (canto inferior direito): um círculo verde com brilhos. Ao passar o mouse, ele se abre e mostra *Perguntar à Active AI*. Some quando o chat está aberto.

## Tela inicial

- **Saudação** conforme o horário do computador: *Bom dia* (até 12h), *Boa tarde* (até 18h), *Boa noite* (depois).
- **Busca principal**: digite e aperte Enter (ou *Buscar*). Leva para a [busca](#busca) com a resposta da Active AI.
- **Lista com abas** *Recentes* e *Mais acessados* (5 documentos). A aba escolhida fica lembrada. *Ver todos →* abre a lista completa.
- Com a base vazia, aparecem atalhos para escrever o primeiro texto ou enviar arquivos.

## Busca

Há duas formas de buscar:

| Forma | Como abrir | O que faz |
| --- | --- | --- |
| **Busca completa** | Tela inicial, campo de filtro da lista ou Enter na busca rápida | Lista todos os resultados e mostra no topo a **Resposta da Active AI** |
| **Busca rápida** | **Ctrl+K** (ou **/**) em qualquer tela | Mostra até 7 resultados enquanto você digita; setas ↑↓ e Enter para abrir; Esc fecha. A última opção leva à busca completa |

Como a busca funciona:

- Procura em **títulos, tags, descrições, conteúdo dos textos, texto extraído dos arquivos, transcrições de vídeos e capítulos**.
- **Ignora acentos e maiúsculas** (`emissao` encontra *Emissão*) e aceita **começo de palavras** (`transm` encontra *transmissão*).
- Primeiro exige **todas** as palavras; se nada aparecer, aceita **qualquer uma**.
- Os termos encontrados aparecem **destacados** no trecho de cada resultado.
- Uma busca feita pela pessoa que **não encontra nada** entra no [relatório de lacunas](#relatório-da-base).

### Resposta da Active AI na busca

No topo dos resultados, a Active AI responde à pergunta usando os documentos encontrados:

- Mostra *Pesquisando na base → Consultando a Active AI* enquanto trabalha.
- A resposta traz links para os documentos usados e, quando o agente oferece alternativas, **botões de opções**.
- **Continuar a conversa** leva a resposta para o chat, na mesma conversa do agente; clicar numa opção já envia a escolha.
- Respostas longas têm **Ajudou? 👍 👎** (veja [Avaliações](#avaliações-isso-ajudou)).
- A resposta fica guardada enquanto a página está aberta: voltar à mesma busca não pergunta de novo.

## Lista de documentos

*Todos os documentos* (ou clicar numa categoria) mostra a lista com filtros:

- **Pesquisar por palavras-chave**, **categoria** e **tipo** (*Textos e arquivos*, *Somente textos*, *Somente arquivos*, *Somente vídeos do YouTube*).
- Cada cartão mostra ícone, título, tipo, categoria, data de atualização, tamanho (arquivos), tags e selos:
  - **Vídeos**: ícone com a **duração** embaixo (vermelho para YouTube, verde para vídeos enviados) e o selo *Transcrito* / *Transcrevendo 40%* / *Sem transcrição*.
  - **Revisar** (amarelo): o prazo de revisão do documento venceu.
- Clicar numa **tag** (na página do documento) lista todos os documentos com ela.

## Página de um documento

### Topo

- Categoria (link de volta), título, tipo, tags e descrição.
- Botões: **Perguntar à Active AI**, **Editar** (ou *Editar informações* para arquivos e vídeos), **Baixar** e **Nova versão** (arquivos), **Abrir no YouTube** (vídeos do YouTube), **Histórico (n)** (textos com versões anteriores) e **Excluir**.

### Conteúdo

| Tipo | Como aparece |
| --- | --- |
| Texto | Formatado (títulos, listas, tabelas, código) |
| PDF | Visualizador dentro da página + o texto lido pela Active AI |
| Imagem | A imagem |
| Vídeo/áudio | Player + painel de [transcrição](04-videos-e-transcricao.md) |
| Outros arquivos | O texto extraído (quando existe) ou o aviso de que o conteúdo não pôde ser lido |

**Tabelas** têm cabeçalho destacado e rolagem lateral quando não cabem. **Blocos de código** mostram a linguagem (SQL, EDI…) e têm o botão **Copiar**; as linhas não quebram, para manter alinhados os layouts de posição fixa (EDI).

### Lateral

- **Dúvidas sobre este documento?** → *Resumir com a Active AI* (para vídeos: resumo com os horários de cada assunto).
- Ficha: categoria, autor, arquivo, duração, link do vídeo, **revisão** (*a cada 6 meses · próxima em dd/mm/aaaa*), tamanho, datas e o **ID** (usado pela Active AI).

### Avisos

- **Revisão vencida** (faixa amarela no topo): *Continua válido* registra a revisão; *Atualizar* abre o editor.
- **Anexo de uma conversa com a Active AI**: o item é temporário e mostra a data em que será apagado; *Manter na base* transforma em documento normal.

### Avaliações ("Isso ajudou?")

No fim de cada documento: **Este documento ajudou? Sim / Não**, com a contagem de quem achou útil. No *Não*, a pessoa pode escrever o que faltou (opcional). Cada navegador vota uma vez por documento. As avaliações aparecem no [Relatório](#relatório-da-base).

### Histórico de versões

*Histórico* lista as versões anteriores do texto (data, autor, título). Clique numa versão para ver como o texto estava e em **Restaurar esta versão** para voltar a ela. Restaurar não apaga nada: a versão atual também entra no histórico.

Uma versão é guardada **sempre que o título, o conteúdo, a descrição ou as tags mudam**. Mudar só a categoria, o autor ou o prazo de revisão não cria versão.

### Excluir

Pede confirmação. Apaga o item, o arquivo do disco, as versões e as avaliações. **Não há lixeira**: para recuperar, só pelo backup.

## Escrever e editar textos

*Escrever texto* abre o editor:

- **Título** (obrigatório), **categoria**, **tags** (separadas por vírgula), **descrição curta**, **autor** (fica lembrado no navegador) e **Revisar a cada** (*Sem revisão periódica*, 3, 6, 12 ou 24 meses; textos novos começam com 6).
- **Modelos** (só em textos novos): *Em branco*, *Problema → Causa → Solução*, *Passo a passo* e *Comunicado*. O modelo preenche a estrutura de títulos; se já houver texto, a plataforma pergunta antes de substituir.
- **Barra de formatação**: negrito, itálico, tachado, títulos, listas, lista de verificação, citação, código, link, tabela e linha divisória.
- **Escrever / Dividir / Visualizar**: alterna entre o texto em Markdown, as duas coisas lado a lado e o resultado formatado.
- **Atalhos**: Ctrl+B (negrito), Ctrl+I (itálico), Ctrl+K (link), **Ctrl+S (salvar)**.
- Sair com alterações não salvas faz o navegador pedir confirmação.

Arquivos e vídeos não têm conteúdo editável: o editor só muda título, categoria, tags, descrição, autor e prazo de revisão.

## Enviar arquivos e vídeos

*Enviar arquivos* tem duas partes:

### Vídeo do YouTube

Cole o link (`youtube.com/watch?v=…`, `youtu.be/…`, `shorts/…`, `live/…`) e clique em **Adicionar vídeo**. Título e canal vêm do YouTube; categoria, tags, descrição e autor preenchidos abaixo também valem. O mesmo vídeo não entra duas vezes (a plataforma abre o que já existe).

### Arquivos

- **Arraste** para a área tracejada ou clique para escolher (vários de uma vez, até 50 por envio).
- Com um arquivo só, dá para definir o **título**; com vários, o título é o nome de cada arquivo.
- Categoria, tags, descrição e autor valem para todos os arquivos do envio.
- A barra mostra o progresso do envio; depois a plataforma lê o conteúdo de cada arquivo.

Formatos com conteúdo lido (pesquisável e usado pela Active AI):

| Formato | Extensões |
| --- | --- |
| Office e documentos | `.pdf`, `.docx`, `.xlsx`, `.pptx`, `.odt`, `.ods`, `.odp`, `.odg`, `.rtf`, `.epub` |
| Texto e código | `.txt`, `.md`, `.csv`, `.tsv`, `.json`, `.xml`, `.yml`, `.log`, `.ini`, `.sql`, `.sh`, `.bat`, `.ps1`, `.js`, `.py`… |
| Páginas | `.html`, `.htm` (só o texto) |
| Vídeo e áudio | `.mp4`, `.mov`, `.mkv`, `.webm`, `.avi`, `.mp3`, `.wav`, `.m4a`… (transcritos) |

Outros formatos (`.zip`, `.doc` antigo, `.exe`…) são guardados e podem ser baixados, mas a Active AI só conhece o título, a descrição e as tags. PDFs digitalizados (imagem) não têm texto legível.

Tamanho máximo por arquivo: **2 GB** (ajustável em `MAX_UPLOAD_MB`).

## Active AI

### Onde ela aparece

| Lugar | Como usar |
| --- | --- |
| **Botão flutuante** (canto inferior direito) | Abre o chat como painel lateral, em qualquer tela |
| **Página Active AI** (menu) | O chat em tela cheia |
| **Busca** | Resposta automática no topo dos resultados |
| **Página de um documento** | *Perguntar à Active AI* ou *Resumir com a Active AI*: o documento entra **em foco** na conversa |

### O chat

- **Base da plataforma primeiro**: a Active AI responde com os documentos da Base de Conhecimento. Se a plataforma não tiver a resposta, ela usa a base geral do GPT Maker e a mensagem mostra o aviso amarelo **Resposta da base geral do GPT Maker** (a pergunta vai para as lacunas do relatório). Respostas longas que não citam nenhum documento mostram o aviso **Sem documentos da plataforma**.
- **Documento em foco**: uma faixa no topo mostra o documento; o agente recebe o id dele para ler. O **×** tira o documento do foco.
- **Opções em botões**: quando o agente oferece alternativas (`[OPCOES] A | B | C`), elas viram botões; clicar envia a escolha.
- **Documentos consultados**: aparecem como links abaixo da resposta.
- **Raciocínio da Active AI**: quando o agente escreve o rascunho de análise (veja [raciocínio obrigatório](03-active-ai-e-integracoes.md#raciocínio-obrigatório-antes-de-responder)), aparece um **!** pequeno ao lado de *Consultando a Active AI* (e ao lado de *Resposta da Active AI* na busca). Clicar mostra como o agente entendeu a pergunta: ação, objeto, contexto, o que encontrou, se responde exatamente e a decisão. Útil para entender uma resposta errada.
- **Ajudou? 👍 👎** nas respostas longas (300+ caracteres). No 👎, a pessoa pode dizer o que faltou, e a pergunta vai para o relatório de lacunas.
- **↻ Nova conversa** começa do zero (nova sessão no agente). A conversa atual fica salva no navegador ao trocar de página ou recarregar.
- **Enter** envia; **Shift+Enter** quebra a linha; o botão vira **■** para interromper a resposta.

### Fixar o chat ao lado

No painel lateral, o **📌** fixa a Active AI ao lado do conteúdo: ela fica aberta enquanto você navega pela plataforma, e a escolha vale mesmo depois de recarregar. Clique no 📌 de novo (ou no ×) para desafixar. Disponível em telas a partir de 1100 px; nas menores o chat abre por cima.

## Anexar arquivos na conversa

No chat, o **📎** (ou arrastar arquivos para o chat) anexa arquivos à próxima mensagem:

1. O arquivo é enviado e lido na hora; o cartão mostra o progresso e depois quantos caracteres foram lidos (ou *sem texto*, se não houver texto legível).
2. Ao enviar a mensagem, o agente recebe **só a referência** (id, nome e tamanho) e lê o conteúdo **inteiro** pelo MCP. Assim não há o limite de texto da mensagem.
3. Sem texto digitado, a mensagem enviada é *Analise o arquivo anexado*.

Regras dos anexos:

- Ficam guardados **temporariamente**: **72 horas** por padrão (`CHAT_ATTACHMENT_HOURS`), fora das listas, da busca e das categorias.
- Abrem pelo cartão do arquivo na conversa. **Manter na base** transforma o anexo em documento normal (e abre a tela para dar título, categoria e tags).
- Depois de vencido, o anexo é apagado (registro e arquivo); o cartão no histórico do chat passa a levar a "documento não encontrado" e o agente não consegue mais lê-lo.
- Vídeos e áudios anexados também são transcritos; enquanto a transcrição não termina, o agente é avisado para pedir que o usuário aguarde.

## Relatório da base

Menu **Relatório**. No topo, quatro indicadores: **lacunas abertas**, **documentos para revisar**, **% de documentos úteis** e **% de respostas úteis** (a partir das avaliações).

### Lacunas

Perguntas que a base não respondeu, agrupadas (a mesma pergunta escrita de jeitos parecidos conta junto) e ordenadas pela frequência. Origens:

| Origem | Quando entra |
| --- | --- |
| **Busca sem resultado** | Alguém fez uma busca completa que não encontrou nada |
| **Active AI não encontrou** | A resposta do agente diz que não encontrou a informação ("não encontrei", "não há informações", "não consta na base"…) |
| **Registrada pelo agente (MCP)** | O próprio agente chamou `registrar_lacuna` |
| **Resposta avaliada 👎** | Alguém marcou uma resposta da Active AI como "não ajudou" |

Ações:

- **Escrever documento**: abre o editor no modelo *Problema → Causa → Solução*, já com a pergunta. **Ao publicar, a lacuna é resolvida** e liga ao documento criado.
- **Resolver**: tira a lacuna da lista (quando já existe documento ou não precisa).
- **Detalhes**: o que o agente procurou, o comentário da avaliação etc.
- **Abertas / Resolvidas**: alterna as listas; nas resolvidas, **Reabrir** volta a lacuna para a lista.

Repetições da mesma pergunta pela mesma origem em menos de 10 minutos contam uma vez só.

### Para revisar

Documentos cujo prazo de revisão venceu (contado a partir da última **edição** ou da última confirmação *Continua válido*, o que for mais recente). Ações: **Continua válido** e **Atualizar**. Enquanto a revisão está vencida, a Active AI avisa quem pergunta que o conteúdo pode estar desatualizado.

### Avaliações

- **Documentos com avaliações negativas**: 👍, 👎 e os comentários de cada um.
- **Respostas da Active AI que não ajudaram**: a pergunta, o comentário e a resposta dada; **Escrever documento** cria o texto que faltou.

## Categorias

O ⚙ ao lado de *Categorias* no menu abre o gerenciamento: **Nova categoria** (nome, descrição e ícone), editar e excluir. Excluir uma categoria **não exclui os documentos**: eles ficam *Sem categoria*. Os nomes não podem se repetir.

## Atalhos de teclado

| Atalho | Onde | Ação |
| --- | --- | --- |
| **Ctrl+K** ou **/** | Qualquer tela | Busca rápida |
| ↑ ↓ Enter Esc | Busca rápida | Navegar, abrir, fechar |
| **Enter** / Shift+Enter | Chat | Enviar / nova linha |
| **Esc** | Chat aberto por cima | Fechar o chat |
| Ctrl+B / Ctrl+I / Ctrl+K | Editor | Negrito / itálico / link |
| **Ctrl+S** | Editor | Salvar |
| Tab | Botão da Active AI | Foca e abre o botão |
