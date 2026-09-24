import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const READ_CHUNK_CHARS = 30_000;

/**
 * Servidor MCP da Base de Conhecimento (transporte Streamable HTTP, sem estado).
 * Permite que agentes externos — como o Active IA no GPTMaker ou no n8n — pesquisem e leiam os documentos.
 */
export function createMcpHandler({ repo, publicUrl = '' }) {
  const link = (id) => `${publicUrl.replace(/\/$/, '')}/#/item/${id}`;
  const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] });

  function buildServer() {
    const server = new McpServer({ name: 'base-conhecimento-active', version: '1.0.0' });

    server.registerTool(
      'buscar_documentos',
      {
        title: 'Buscar documentos na Base de Conhecimento',
        description:
          'Pesquisa em texto completo nos documentos da Base de Conhecimento do Suporte da Active Corp (títulos, tags, descrições e conteúdo de textos e arquivos). ' +
          'Retorna os documentos mais relevantes com id, título, categoria, trecho encontrado e link. Use palavras-chave; tente sinônimos se não encontrar.',
        inputSchema: {
          consulta: z.string().min(1).describe('Palavras-chave da busca'),
          limite: z.number().int().min(1).max(25).optional().describe('Máximo de resultados (padrão 8)'),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ consulta, limite }) => {
        const results = repo.search(consulta, { limit: limite || 8 });
        if (!results.length) return text(`Nenhum documento encontrado para "${consulta}".`);
        return text(
          results.map((r) => ({
            id: r.id,
            titulo: r.title,
            tipo: r.kind === 'article' ? 'texto' : 'arquivo',
            categoria: r.category_name || 'Sem categoria',
            tags: r.tags,
            resumo: r.summary || undefined,
            trecho: r.snippet?.replace(/\[\[|\]\]/g, ''),
            link: link(r.id),
          })),
        );
      },
    );

    server.registerTool(
      'ler_documento',
      {
        title: 'Ler documento',
        description:
          `Lê o conteúdo completo de um documento pelo id. Textos longos vêm em partes de ${READ_CHUNK_CHARS} caracteres; ` +
          'se houver continuação, a resposta informa o próximo valor de "inicio".',
        inputSchema: {
          id: z.number().int().describe('Id do documento'),
          inicio: z.number().int().min(0).optional().describe('Posição inicial (padrão 0)'),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ id, inicio = 0 }) => {
        const item = repo.getItem(id, { full: true });
        if (!item) return { ...text(`Documento ${id} não encontrado.`), isError: true };
        const body = (item.kind === 'article' ? item.content : item.text) || '';
        const chunk = body.slice(inicio, inicio + READ_CHUNK_CHARS);
        const next = inicio + chunk.length;
        return text({
          id: item.id,
          titulo: item.title,
          categoria: item.category_name || 'Sem categoria',
          tags: item.tags,
          resumo: item.summary || undefined,
          arquivo: item.file_name || undefined,
          link: link(item.id),
          total_caracteres: body.length,
          conteudo: chunk || '(documento sem texto legível)',
          ...(next < body.length ? { continua: true, proximo_inicio: next } : {}),
        });
      },
    );

    server.registerTool(
      'listar_documentos',
      {
        title: 'Listar documentos',
        description: 'Lista os documentos mais recentes da base, opcionalmente de uma categoria.',
        inputSchema: {
          categoria_id: z.number().int().optional().describe('Id da categoria'),
          limite: z.number().int().min(1).max(100).optional().describe('Quantidade (padrão 30)'),
        },
        annotations: { readOnlyHint: true },
      },
      async ({ categoria_id, limite }) => {
        const { items, total } = repo.listItems({ categoryId: categoria_id, limit: limite || 30 });
        return text({
          total,
          documentos: items.map((i) => ({ id: i.id, titulo: i.title, categoria: i.category_name || 'Sem categoria', atualizado_em: i.updated_at, link: link(i.id) })),
        });
      },
    );

    server.registerTool(
      'listar_categorias',
      {
        title: 'Listar categorias',
        description: 'Lista as categorias da base com id, descrição e quantidade de documentos.',
        inputSchema: {},
        annotations: { readOnlyHint: true },
      },
      async () =>
        text(repo.listCategories().map((c) => ({ id: c.id, nome: c.name, descricao: c.description, documentos: c.item_count }))),
    );

    return server;
  }

  // Modo sem estado: um servidor e um transporte por requisição.
  return async function handleMcp(req, res) {
    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST.' }, id: null });
      return;
    }
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('[mcp] Erro:', err);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno' }, id: null });
    }
  };
}
