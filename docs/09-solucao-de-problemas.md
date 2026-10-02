# 9. Solução de problemas

Comandos úteis (no servidor ou no terminal do Codespace):

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3001/   # 200 ou 401 = plataforma no ar; 000 = parada
tail -f servidor.log                                                # log ao vivo (Ctrl+C sai sem desligar)
grep "\[mcp" servidor.log | tail -20                                # chamadas do agente ao MCP
grep "active-ai/n8n" servidor.log | tail -20                        # erros na conversa com o n8n
grep "\[transcrição\]\|\[capítulos\]" servidor.log | tail -20       # vídeos
npm run mcp:testar -- https://ENDERECO SEU_TOKEN                    # testa o MCP como o agente faria
```

## A plataforma não abre

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| **404** no endereço do Codespace | A plataforma não está rodando (o Codespace reiniciou) | `PORT=3001 nohup npm start > servidor.log 2>&1 &` |
| 404 mesmo com a plataforma rodando | Encaminhamento da porta travou | Aba Portas → parar o encaminhamento da 3001 → adicionar de novo → Pública → abrir pelo globo |
| Pede login do GitHub | Porta 3001 está *Private* | Aba Portas → botão direito → Visibilidade → **Pública** |
| `Erro: a porta 3001 já está em uso` | Outra cópia já está rodando | `pkill -f server/index.js` e inicie de novo |
| `curl` responde `000` | A plataforma parou (por exemplo, Ctrl+C no terminal dela) | Inicie em segundo plano com `nohup` (acima) |
| Tela antiga depois de atualizar | Cache do navegador | **Ctrl+Shift+R** |
| Não consigo digitar no terminal do Codespace | Terminal ocupado pela plataforma ou somente leitura | Abra um terminal novo (**+** no painel do terminal) |
| `git pull` recusa por causa do `package-lock.json` | Alteração local no arquivo | `git checkout -- package-lock.json` e `git pull` |

## Active AI

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| *A Active AI ainda não foi configurada* | `N8N_WEBHOOK_URL` vazio | Preencha no `.env` e reinicie |
| *Não foi possível conectar ao n8n (UND_ERR_CONNECT_TIMEOUT)* | O servidor não alcança o n8n (no Codespace: o firewall do n8n bloqueou o endereço do datacenter) | Teste: `curl -m 20 -X POST https://n8n…/webhook/active-ia-msg -H "Content-Type: application/json" -d '{"prompt":"teste","contextId":"teste"}'`. Timeout = bloqueio de rede: peça a liberação do IP (`curl -s https://api.ipify.org`) ou reinicie o Codespace para trocar de IP. Em produção, hospede na mesma rede do n8n |
| *A conexão com o n8n caiu depois de X s* | O agente demorou (por exemplo, lendo vários anexos) e um proxy na frente do n8n encerrou a conexão | Aumente o tempo limite do proxy do n8n; X perto de 100 s indica limite de proxy (Cloudflare/nginx) |
| *demorou mais de 240 s* | Resposta muito longa ou agente travado | Tente de novo; ajuste `N8N_TIMEOUT_SECONDS` (máximo prático ~290) |
| *O fluxo do n8n retornou erro 4xx/5xx* | Workflow inativo ou com erro | Confira se o workflow está **ativo** e a URL é a de **produção** (não a de teste) |
| *O n8n respondeu, mas sem texto* | O nó *Respond to Webhook* devolve outro formato | Faça ele responder `{ "message": "…" }` (veja [formatos aceitos](03-active-ai-e-integracoes.md#resposta-esperada-do-n8n)) |
| O chat oficial mostra `<analise>…` | O trecho do prompt foi ativado sem o nó do n8n | Adicione o nó `n8n/remover-analise.js` antes do "Responder ao chat" |
| Resposta "parecida mas errada" | O agente respondeu o assunto mais próximo sem conferir | Ative o [raciocínio obrigatório](03-active-ai-e-integracoes.md#raciocínio-obrigatório-antes-de-responder) e confira o rascunho no log (`grep "active-ai/análise" servidor.log`) |
| `[OPCOES] A \| B` aparece como texto | Formato diferente do esperado | A linha precisa começar com `[OPCOES]` (ou `[OPÇÕES]`) e as opções separadas por `\|` |

## MCP (o agente não consegue ler a base)

No GPTMaker, *Inspecionar resposta* mostra a chamada; *Dados recebidos* com `Error: error on connect with mcp server` significa que o GPTMaker não conseguiu falar com a plataforma.

1. **A plataforma está no ar e a porta pública?** (veja a primeira tabela).
2. **O MCP responde pelo endereço público?** `npm run mcp:testar -- https://ENDERECO SEU_TOKEN` deve listar 6 ferramentas.
3. **A chamada chegou?** `grep "\[mcp" servidor.log | tail`:
   - nenhuma linha no horário: endereço errado, porta privada ou plataforma parada;
   - `→ 401`: token do GPTMaker diferente do `INTEGRATION_TOKEN`;
   - `→ 429`: muitas tentativas com token errado; aguarde 10 minutos e corrija o token;
   - `→ 200`: a plataforma respondeu; o problema está do lado do GPTMaker.
4. **Configuração no GPTMaker**: Streamable HTTP, URL terminando em `/mcp`, autenticação por **Headers** (`Authorization: Bearer TOKEN`), não OAuth. Depois de mudar o endereço, o token ou as ferramentas, **reconecte**.

| Sintoma | O que fazer |
| --- | --- |
| *ERRO AO OBTER CONFIGURAÇÃO DE OAUTH* | Escolha autenticação por **Headers**, não OAuth |
| Agente diz que o arquivo "não ficou disponível pelo ID" | Confira no log se houve `ler_documento #ID`. Se o anexo tiver mais de 72 h, ele expirou: anexe de novo |
| Links do agente sem o endereço completo | Defina `PUBLIC_URL` |

## Vídeos

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| *O motor de transcrição não está instalado* | Dependências opcionais não instaladas | `npm ci` (precisa de internet para baixar o onnxruntime e o ffmpeg) |
| Transcrição demora | Normal: ~1× a duração do vídeo; na primeira vez ainda baixa o modelo | Acompanhe com `grep "\[transcrição\]" servidor.log`; para mais velocidade, `TRANSCRIPTION_MODEL=Xenova/whisper-base` |
| YouTube: *bloqueou a leitura das legendas a partir deste servidor* | O YouTube pede login a servidores de nuvem | Use **Colar** (transcrição do YouTube) ou rode a plataforma no servidor da Active; veja o log `Legendas de … não lidas` |
| YouTube: *não tem legendas* | O vídeo não tem legenda nem automática | **Colar**, ou instale o yt-dlp (`YTDLP_PATH`) |
| Player do YouTube não carrega | Vídeo não permite incorporação | Use *Abrir no YouTube* |
| *Não foi possível gerar os capítulos* | O agente não respondeu no formato ou não conseguiu ler a transcrição pelo MCP | Confira o MCP no GPTMaker e clique em **Tentar de novo** |
| Vídeo enviado não toca na página | Formato que o navegador não reproduz (MOV, MKV, AVI…) | Baixe para assistir; a transcrição funciona normalmente |

## Busca

| Sintoma | O que fazer |
| --- | --- |
| Documento não aparece na busca | Arquivos digitalizados (PDF de imagem) e formatos não suportados não têm texto; adicione **descrição** e **tags** ao documento |
| Busca demais / de menos | A busca exige todas as palavras e, sem resultado, aceita qualquer uma; use palavras-chave em vez de frases |
| Nenhum resultado *≈ significado* | Veja `GET /api/stats` → `semantic`. `error` preenchido: o modelo não carregou (precisa de internet na primeira vez para baixar do Hugging Face); `pending` > 0: ainda indexando. Log: `grep "busca semântica" servidor.log` |
| Resultados *≈ significado* sem relação | Aumente `SEMANTIC_MIN_SCORE` (ex.: `0.82`) olhando as notas no log `[busca semântica]` |
| Sinônimo não encontra o documento | Cadastre o termo e o sinônimo no **Glossário** (o termo tem de aparecer como palavra inteira na busca) |

## Login

| Sintoma | Causa provável | O que fazer |
| --- | --- | --- |
| Aparece *Primeiro acesso* | Ainda não há nenhuma conta (banco novo ou pasta `data/` trocada) | Crie o administrador. Se esperava ver contas, confira o `DATA_DIR` |
| *E-mail ou senha incorretos* | Senha errada, e-mail com outro endereço ou conta excluída | Administrador: **Pessoas** → chave → nova senha provisória |
| *Seu acesso está bloqueado* | Conta bloqueada em **Pessoas** | Administrador libera a caixa *Acesso* |
| *Muitas tentativas erradas* | 10 erros em 10 minutos do mesmo endereço | Aguarde 10 minutos. Atrás de proxy, configure `TRUST_PROXY=1` (senão todos dividem o mesmo limite) |
| O administrador esqueceu a senha | — | No servidor: `npm run admin -- email@empresa.com.br` gera uma senha provisória |
| Volta para o login a cada página | Cookie não está sendo guardado (ex.: `PUBLIC_URL` com `https://` mas acesso por `http://`) | Acesse pelo mesmo endereço do `PUBLIC_URL` |
| Não aparece o menu Pessoas | Só administradores veem | Um administrador muda o seu perfil |
| Botões de editar sumiram | Perfil *Só consulta* | Um administrador muda o perfil em **Pessoas**; recarregue a página |
