# 11. Login, busca por significado e glossário

Três recursos que trabalham juntos:

- **Login próprio**: cada pessoa entra com e-mail e senha, em contas criadas pelo administrador. A plataforma registra quem criou e quem editou cada documento, e cada pessoa tem um perfil (*Administrador*, *Editor* ou *Só consulta*).
- **Busca por significado**: encontra documentos que falam do assunto mesmo sem as mesmas palavras ("cliente não consegue tirar nota" acha "Erro na emissão de NF-e"). Roda **no próprio servidor**, sem custo e sem mandar texto para fora.
- **Glossário da Active**: tabela de termos, siglas e sinônimos. Amplia a busca e explica os termos internos à Active AI.

---

## Login próprio (e-mail e senha)

A plataforma tem login próprio: não depende de Microsoft, Google ou outro serviço, e não tem custo.

### Primeiro acesso

Ao abrir a plataforma pela primeira vez (sem nenhuma conta criada), aparece a página **Primeiro acesso**: informe nome, e-mail e senha e você vira o **administrador**.

> ⚠️ Enquanto não houver conta, **quem abrir o endereço primeiro cria o administrador**. Crie a sua conta logo depois de instalar ou de deixar a porta pública. O terminal avisa ao iniciar enquanto não houver conta.

Alternativa pelo terminal do servidor (também serve para **recuperar o acesso** se o administrador esquecer a senha):

```bash
npm run admin -- seu.email@activecorp.com.br "Seu Nome"
```

O comando cria o administrador (ou, se o e-mail já existe, torna a pessoa administradora, libera o acesso e gera uma senha nova) e mostra uma **senha provisória**.

### Criar as contas da equipe

1. Menu **Pessoas** → **Nova pessoa**.
2. Informe nome, e-mail e perfil.
3. A plataforma mostra uma **senha provisória** (ex.: `5mgw-ajs6-gdrf`) **uma única vez**. Use **Copiar acesso** e envie para a pessoa por um canal seguro (Teams, pessoalmente).
4. No primeiro login, a pessoa precisa **criar a própria senha** antes de usar a plataforma. Até lá, a conta aparece com a etiqueta *senha provisória*.

Em **Pessoas**, o administrador também:

| Ação | Como |
| --- | --- |
| Mudar o perfil | Lista *Perfil* |
| Bloquear / liberar o acesso | Caixa *Acesso*. Bloquear desconecta a pessoa na hora |
| Corrigir nome ou e-mail | Ícone de lápis |
| **Esqueceu a senha** | Ícone de chave → gera uma nova senha provisória (a antiga para de valer e a pessoa é desconectada) |
| Excluir a conta | Lixeira. Os documentos da pessoa continuam na base, com o nome dela como autor |

Um administrador não pode tirar o próprio acesso de administrador, bloquear-se nem excluir a própria conta.

Cada pessoa troca a própria senha pelo ícone de chave no rodapé do menu (pede a senha atual). Trocar a senha desconecta os outros aparelhos.

### Perfis

| Perfil | Pode |
| --- | --- |
| **Administrador** | Tudo o que o Editor faz, mais a tela **Pessoas** |
| **Editor** | Criar, editar, excluir e enviar documentos; categorias; glossário; transcrições; resolver lacunas |
| **Só consulta** | Pesquisar, ler, baixar, conversar com a Active AI (inclusive anexar arquivos à conversa) e avaliar 👍👎 |

O servidor recusa (403) qualquer alteração que o perfil não permita; a interface só esconde os botões.

### Quem criou e quem editou

- **Autor**: quem criou o documento (vem do login; o campo "Autor" some dos formulários).
- **Atualizado por**: quem fez a última alteração, mostrado no painel lateral do documento.
- O **histórico de versões** guarda quem tinha salvo cada versão, e restaurar uma versão registra quem restaurou.
- As avaliações "não ajudou" das respostas da Active AI mostram quem avaliou, no relatório.

### Como as senhas e sessões são protegidas

- Senhas guardadas com **scrypt** e sal individual; nem o administrador vê as senhas das pessoas.
- Mínimo de 10 caracteres; senhas óbvias (`1234567890`, o próprio e-mail ou nome) são recusadas. Dica para a equipe: uma frase de 3 ou 4 palavras (`cavalo bateria grampo azul`) é fácil de lembrar e difícil de adivinhar.
- **10 tentativas erradas em 10 minutos** bloqueiam o endereço até a janela passar. A mensagem de erro é a mesma para e-mail inexistente e senha errada (não revela quem tem conta).
- Sessão num cookie `kb_sessao` (HttpOnly, SameSite=Lax, Secure em HTTPS) que vale `SESSION_DAYS` dias e é renovada com o uso. No banco fica só o hash do cookie.
- Os formulários de login só são aceitos vindos da própria plataforma.

O MCP e a API de integração não usam login: continuam com o `INTEGRATION_TOKEN`.

### Variáveis

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `SESSION_DAYS` | `30` | Dias até a pessoa precisar entrar de novo (sem uso) |
| `PUBLIC_URL` | vazio | Endereço público; quando começa com `https://`, o cookie sai com `Secure` |
| `LOGIN` | `on` | `off` desliga o login (qualquer pessoa com o endereço acessa tudo). **Só para testes locais** |

### Testar no Codespace

1. `git pull`, reinicie a plataforma e abra o endereço público (ou o do túnel `trycloudflare`, se o do Codespace der 404; veja [5. Instalação](05-instalacao-e-configuracao.md#se-o-endereço-do-codespace-der-404)): aparece **Primeiro acesso**. Crie a sua conta.
2. Em **Pessoas**, crie uma conta de teste com o perfil *Só consulta*.
3. Abra uma janela anônima, entre com a conta de teste e a senha provisória, crie a senha e confira que os botões de edição não aparecem.

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
