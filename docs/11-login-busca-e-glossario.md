# 11. Login individual, busca por significado e glossário

Três recursos que trabalham juntos:

- **Login individual**: cada pessoa entra com a conta **Microsoft** ou **Google** da empresa. A plataforma registra quem criou e quem editou cada documento, e cada pessoa tem um perfil (*Administrador*, *Editor* ou *Só consulta*).
- **Busca por significado**: encontra documentos que falam do assunto mesmo sem as mesmas palavras ("cliente não consegue tirar nota" acha "Erro na emissão de NF-e"). Roda **no próprio servidor**, sem custo e sem mandar texto para fora.
- **Glossário da Active**: tabela de termos, siglas e sinônimos. Amplia a busca e explica os termos internos à Active AI.

---

## Login individual (Microsoft ou Google)

### Como funciona

1. Quem abre a plataforma sem estar logado vai para a página **Entrar**, com um botão para cada provedor configurado.
2. O login é feito na Microsoft ou no Google (padrão OpenID Connect, com PKCE, `state` e `nonce`). A plataforma **nunca vê a senha** da pessoa.
3. Na volta, a plataforma confere o e-mail e o domínio (`AUTH_ALLOWED_DOMAINS`) e cria uma sessão: um cookie `kb_sessao` (HttpOnly, SameSite=Lax, Secure em HTTPS) que vale `SESSION_DAYS` dias e é renovado com o uso. No banco fica só o hash do cookie.
4. A pessoa aparece em **Pessoas** no primeiro login. **A primeira pessoa a entrar vira Administrador**; as seguintes recebem o perfil `AUTH_DEFAULT_ROLE` (padrão *Editor*), exceto os e-mails em `ADMIN_EMAILS`, que entram como Administrador.

Com o login ligado, a senha única (`BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`) deixa de ser usada. O MCP e a API de integração continuam usando o `INTEGRATION_TOKEN`.

### Perfis

| Perfil | Pode |
| --- | --- |
| **Administrador** | Tudo o que o Editor faz, mais a tela **Pessoas**: mudar perfis e bloquear acessos |
| **Editor** | Criar, editar, excluir e enviar documentos; categorias; glossário; transcrições; resolver lacunas |
| **Só consulta** | Pesquisar, ler, baixar, conversar com a Active AI (inclusive anexar arquivos à conversa) e avaliar 👍👎 |

O servidor recusa (403) qualquer alteração que o perfil não permita; a interface só esconde os botões.

Bloquear uma pessoa em **Pessoas** encerra na hora todas as sessões dela. Um administrador não pode tirar o próprio acesso de administrador (para a plataforma nunca ficar sem nenhum).

### Quem criou e quem editou

- **Autor**: quem criou o documento (preenchido pelo login; o campo "Autor" some dos formulários).
- **Atualizado por**: quem fez a última alteração, mostrado no painel lateral do documento.
- O **histórico de versões** guarda quem tinha salvo cada versão, e restaurar uma versão registra quem restaurou.
- As avaliações "não ajudou" das respostas da Active AI mostram quem avaliou, no relatório.

### Registrar a plataforma na Microsoft (Entra ID / Azure AD)

1. Acesse o [portal do Azure](https://portal.azure.com) → **Microsoft Entra ID** → **Registros de aplicativo** → **Novo registro**.
2. Nome: `Base de Conhecimento`. Tipos de conta: **somente contas deste diretório organizacional**.
3. **URI de redirecionamento**: plataforma **Web**, endereço `https://SEU-ENDERECO/auth/microsoft/callback` (o mesmo `PUBLIC_URL` do `.env`).
4. Depois de criar, copie **ID do aplicativo (cliente)** → `MICROSOFT_CLIENT_ID` e **ID do diretório (locatário)** → `MICROSOFT_TENANT_ID`.
5. **Certificados e segredos** → **Novo segredo do cliente** → copie o **Valor** → `MICROSOFT_CLIENT_SECRET`. Anote a data de validade: quando o segredo vencer, o login para de funcionar até ser trocado.
6. Em **Permissões de API**, as permissões `openid`, `email` e `profile` (Microsoft Graph, delegadas) já bastam.

### Registrar a plataforma no Google (Google Workspace)

1. Acesse o [Google Cloud Console](https://console.cloud.google.com) → crie ou escolha um projeto.
2. **APIs e serviços** → **Tela de consentimento OAuth** → tipo **Interno** (só contas do Workspace da empresa).
3. **Credenciais** → **Criar credenciais** → **ID do cliente OAuth** → tipo **Aplicativo da Web**.
4. **URIs de redirecionamento autorizados**: `https://SEU-ENDERECO/auth/google/callback`.
5. Copie o **ID do cliente** → `GOOGLE_CLIENT_ID` e a **chave secreta** → `GOOGLE_CLIENT_SECRET`.

Os dois provedores podem ficar ligados ao mesmo tempo (a página Entrar mostra os dois botões). Qualquer outro provedor OpenID Connect (Keycloak, Okta, Authentik…) funciona com `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` e `OIDC_LABEL`, com o retorno em `/auth/oidc/callback`.

### Variáveis

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` / `MICROSOFT_TENANT_ID` | vazio | Liga o botão "Entrar com Microsoft" |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | vazio | Liga o botão "Entrar com Google" |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` / `OIDC_LABEL` | vazio | Outro provedor OpenID Connect |
| `AUTH_ALLOWED_DOMAINS` | vazio | Domínios aceitos, separados por vírgula (ex.: `activecorp.com.br`). **Recomendado**, principalmente com o Google |
| `ADMIN_EMAILS` | vazio | E-mails que sempre entram como Administrador |
| `AUTH_DEFAULT_ROLE` | `editor` | Perfil de quem entra pela primeira vez: `editor` ou `leitor` |
| `SESSION_DAYS` | `30` | Dias até a pessoa precisar entrar de novo (sem uso) |
| `PUBLIC_URL` | vazio | **Obrigatório em produção**: o endereço usado nas URIs de retorno |

Se nenhum provedor estiver configurado, a plataforma funciona como antes (senha única ou aberta).

### Testar no Codespace

1. Use o endereço público do Codespace como `PUBLIC_URL` (ex.: `https://NOME-3001.app.github.dev`) e cadastre `https://NOME-3001.app.github.dev/auth/microsoft/callback` como URI de redirecionamento no Azure (pode ficar junto da URI de produção).
2. Reinicie a plataforma, abra o endereço e entre. A primeira conta vira Administrador.
3. Teste o perfil *Só consulta* com uma segunda conta: em **Pessoas**, mude o perfil dela e recarregue a página dela.

---

## Busca por significado (semântica)

### Como funciona

- Cada documento é dividido em trechos de ~900 caracteres, e cada trecho vira um **vetor de significado** calculado pelo modelo **multilingual-e5-small** (entende português), rodando no próprio servidor com o `@huggingface/transformers` (o mesmo pacote da transcrição).
- Na busca, a pergunta também vira um vetor; os trechos mais parecidos indicam os documentos.
- O resultado final junta **três listas**: busca por palavras (FTS5), busca pelas palavras trocadas pelos sinônimos do glossário e busca por significado. A junção usa *Reciprocal Rank Fusion*: um documento bem colocado em mais de uma lista sobe.
- Documentos achados **só pelo significado** aparecem com a etiqueta **≈ significado** e com o trecho mais parecido. No MCP, vêm com `encontrado_por` para o agente conferir se o documento responde mesmo.
- Vale para a tela de busca, para a resposta da Active AI na busca, para o MCP (`buscar_documentos`) e para a API de integração.

### Indexação

- Na primeira vez, o modelo (~120 MB) é baixado do Hugging Face e todos os documentos são indexados em segundo plano. A busca por palavras funciona normalmente enquanto isso.
- Depois, só o que muda é reindexado (cada documento guarda um *hash* do conteúdo). Anexos temporários do chat não entram.
- Os vetores ficam na tabela `item_chunks` do banco e em memória (uns 2 KB por trecho: 10 mil trechos ≈ 20 MB de RAM).
- Se o modelo não puder ser carregado (sem internet na primeira vez, pacote não instalado), a busca por significado se desliga sozinha e o log mostra `[busca semântica] Desligada: …`. A busca por palavras continua.

### Calibrar

Cada busca registra no log os três documentos mais parecidos e a nota (de 0 a 1):

```
[busca semântica] "cliente não consegue tirar nota" → #12 0.871, #40 0.842, #7 0.815
```

Só entram trechos com nota acima de `SEMANTIC_MIN_SCORE` (padrão `0.8`, adequado ao e5). Se aparecerem documentos sem relação, aumente (ex.: `0.82`); se faltarem documentos óbvios, diminua (ex.: `0.78`).

### Variáveis

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `SEMANTIC_SEARCH` | `auto` | `off` desliga a busca por significado |
| `SEMANTIC_MODEL` | `Xenova/multilingual-e5-small` | Modelo de vetores. `Xenova/multilingual-e5-base` é mais preciso e ~3× mais pesado. Trocar o modelo reindexa tudo |
| `SEMANTIC_DTYPE` | `q8` | Precisão do modelo (`q8` é mais leve; `fp32` é mais preciso e lento) |
| `SEMANTIC_MIN_SCORE` | `0.8` | Nota mínima de semelhança |

O estado aparece em `GET /api/stats` → `semantic: { enabled, ready, model, indexed, pending, error }`.

---

## Glossário da Active

Menu **Glossário**. Cada termo tem:

- **Termo**: ex. `CT-e`.
- **Sinônimos e siglas**, separados por vírgula: ex. `CTe, conhecimento de transporte`.
- **O que significa** (opcional): explicação curta para a Active AI.

Como ele é usado:

| Onde | O que acontece |
| --- | --- |
| Busca por palavras | Quem procura "conhecimento de transporte" também encontra os documentos que só dizem "CT-e" (e vice-versa) |
| Busca por significado | A pergunta é ampliada com os sinônimos antes de virar vetor |
| Active AI (modo livre) | Os termos citados na pergunta vão junto da mensagem, em "[Termos da Active citados na pergunta (glossário)]", com no máximo ~450 caracteres |
| MCP | `buscar_documentos` devolve `{ glossario, documentos }` quando a busca cita termos do glossário; a ferramenta `consultar_glossario` explica um termo ou lista o glossário |

Todos podem consultar o glossário; só Editores e Administradores alteram.

Dica: comece pelos termos que mais confundem quem chega no Suporte (siglas fiscais, nomes de telas, módulos, nomes internos de clientes e sistemas) e pelas palavras que aparecem no relatório de **lacunas**.
