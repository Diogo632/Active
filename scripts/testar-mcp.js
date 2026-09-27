// Testa o servidor MCP da Base de Conhecimento como um agente faria.
// Uso:  npm run mcp:testar -- [URL] [TOKEN] [palavra para buscar]
// Sem URL, encontra a plataforma rodando localmente e usa o INTEGRATION_TOKEN do .env.
import 'dotenv/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const [urlArg, tokenArg, queryArg] = process.argv.slice(2);
const token = tokenArg || process.env.INTEGRATION_TOKEN;
// Sem URL, procura a plataforma nas portas mais usadas (a do .env, 3001 e 3000).
async function findLocal() {
  const ports = [...new Set([process.env.PORT, '3001', '3000'].filter(Boolean))];
  for (const port of ports) {
    try {
      const res = await fetch(`http://localhost:${port}/api/stats`, { signal: AbortSignal.timeout(1500) });
      if (res.ok || res.status === 401) return `http://localhost:${port}/mcp`;
    } catch {
      /* porta sem resposta: tenta a próxima */
    }
  }
  console.error(`✖ A plataforma não está rodando nas portas ${ports.join(', ')}. Inicie com "PORT=3001 npm start" em outro terminal.`);
  process.exit(1);
}
// Aceita o endereço da plataforma com ou sem "/mcp" no final.
const base = (urlArg || (await findLocal())).replace(/\/+$/, '').replace(/(\/mcp)?$/, '/mcp');
const query = queryArg || 'processo';

if (!token) {
  console.error('✖ Defina INTEGRATION_TOKEN no .env (ou passe o token como 2º argumento).');
  process.exit(1);
}

const ok = (msg) => console.log(`✔ ${msg}`);
const fail = (msg, err) => {
  console.error(`✖ ${msg}${err ? `: ${err.message}` : ''}`);
  process.exitCode = 1;
};

async function run(label, transport) {
  console.log(`\n— ${label}`);
  const client = new Client({ name: 'teste-mcp-base', version: '1.0.0' });
  try {
    await client.connect(transport);
    ok('Conectado');
    const { tools } = await client.listTools();
    ok(`Ferramentas: ${tools.map((t) => t.name).join(', ')}`);
    const cats = JSON.parse((await client.callTool({ name: 'listar_categorias', arguments: {} })).content[0].text);
    ok(`Categorias: ${cats.map((c) => `${c.nome} (${c.documentos})`).join(', ') || 'nenhuma'}`);
    const res = (await client.callTool({ name: 'buscar_documentos', arguments: { consulta: query, limite: 3 } })).content[0].text;
    if (res.startsWith('Nenhum')) {
      ok(`Busca por "${query}": nenhum documento (tente outra palavra como 3º argumento)`);
    } else {
      const found = JSON.parse(res);
      ok(`Busca por "${query}": ${found.map((d) => `#${d.id} ${d.titulo}`).join(' | ')}`);
      const doc = JSON.parse((await client.callTool({ name: 'ler_documento', arguments: { id: found[0].id } })).content[0].text);
      ok(`Leitura de #${doc.id} "${doc.titulo}": ${doc.total_caracteres} caracteres · link ${doc.link}`);
    }
  } catch (err) {
    fail('Falhou', err);
  } finally {
    await client.close().catch(() => {});
  }
}

console.log(`Testando o MCP em ${base}`);
await run('Streamable HTTP (/mcp)', new StreamableHTTPClientTransport(new URL(base), {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
}));
await run('SSE (/mcp/sse, token na URL)', new SSEClientTransport(new URL(`${base}/sse?token=${encodeURIComponent(token)}`)));
console.log(process.exitCode ? '\nAlgum teste falhou.' : '\nTudo certo: o MCP está pronto para o agente.');
