# Documentação da Base de Conhecimento · Suporte Active Corp

Plataforma web da base de conhecimento do Suporte da Active Corp, com a assistente **Active AI** integrada (agente do GPTMaker, chamado pelo n8n e com acesso à base pelo MCP).

## Para quem é cada parte

| Documento | Para quem | O que tem |
| --- | --- | --- |
| [1. Visão geral e arquitetura](01-visao-geral.md) | Todos | O que a plataforma faz, como as peças se conectam, fluxo de uma pergunta |
| [2. Guia de uso](02-guia-de-uso.md) | Equipe do Suporte | Todas as telas e funções, passo a passo |
| [3. Active AI, n8n, GPTMaker e MCP](03-active-ai-e-integracoes.md) | Quem configura o agente | Como a plataforma conversa com o agente, ferramentas MCP, prompt recomendado |
| [4. Vídeos, transcrição e YouTube](04-videos-e-transcricao.md) | Equipe e infraestrutura | Transcrição automática, legendas do YouTube, capítulos |
| [5. Instalação, configuração e hospedagem](05-instalacao-e-configuracao.md) | Infraestrutura | Requisitos, variáveis do `.env`, Codespaces, produção, backup, atualização |
| [6. Referência da API](06-api.md) | Desenvolvimento e integrações | Todas as rotas HTTP, parâmetros e respostas |
| [7. Dados e armazenamento](07-dados-e-armazenamento.md) | Infraestrutura e desenvolvimento | Banco de dados, tabelas, arquivos, retenção, backup |
| [8. Segurança](08-seguranca.md) | Infraestrutura e gestão | Proteções existentes, checklist de produção, limites conhecidos |
| [9. Solução de problemas](09-solucao-de-problemas.md) | Todos | Erros conhecidos e como resolver |
| [10. Desenvolvimento](10-desenvolvimento.md) | Desenvolvimento | Estrutura do código, testes, como estender |
| [11. Login, busca por significado e glossário](11-login-busca-e-glossario.md) | Infraestrutura e gestão | Login com Microsoft/Google, perfis, registro dos apps, busca semântica, glossário |

## Resumo em um minuto

- **O que é**: um site interno onde o Suporte guarda **textos** (escritos na própria plataforma), **arquivos de qualquer tipo** (PDF, Word, Excel, imagens…) e **vídeos** (enviados ou do YouTube, com transcrição).
- **Busca primeiro**: a tela inicial é uma busca; os resultados vêm com uma **resposta da Active AI** e **Ctrl+K** busca de qualquer tela.
- **Active AI**: chat livre com o agente do GPTMaker. O agente consulta a base sozinho pelo **MCP** (busca e lê documentos inteiros), sem o limite de ~4.000 caracteres das mensagens do GPTMaker.
- **Login individual**: cada pessoa entra com a conta Microsoft ou Google da empresa, com perfis *Administrador*, *Editor* e *Só consulta*, e a plataforma registra quem criou e quem editou cada documento.
- **Busca por significado e glossário**: a busca entende o assunto mesmo sem as mesmas palavras (modelo rodando no próprio servidor) e usa o glossário de termos e sinônimos da Active.
- **Base viva**: relatório de **lacunas** (o que as pessoas procuraram e não acharam), **avaliações** 👍👎, **histórico de versões**, **prazo de revisão** e **modelos de texto**.
- **Tecnologia**: Node.js 22 + Express 5, banco SQLite (com busca FTS5) e interface em JavaScript puro, sem etapa de build. Tudo roda em um único processo, com os dados na pasta `data/`.
