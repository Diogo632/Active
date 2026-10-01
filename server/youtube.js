import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ID = /^[\w-]{11}$/;

/** Extrai o id de um link do YouTube (watch, youtu.be, shorts, embed, live) ou do próprio id. */
export function parseYouTubeId(input) {
  const raw = String(input || '').trim();
  if (ID.test(raw)) return raw;
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/)?.[1] || null;
  }
  return id && ID.test(id) ? id : null;
}

export const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;

const decodeEntities = (s) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/**
 * Lê as legendas do YouTube nos dois formatos XML usados pelo site:
 * <text start="1.2" dur="3">…</text> e (srv3) <p t="1200" d="3000"><s>…</s></p>.
 */
export function parseCaptionXml(xml) {
  const chunks = [];
  const clean = (s) => decodeEntities(decodeEntities(s.replace(/<[^>]+>/g, ''))).replace(/\s+/g, ' ').trim();
  for (const m of String(xml).matchAll(/<text\b[^>]*\bstart="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g)) {
    const text = clean(m[2]);
    if (text) chunks.push({ start: Number(m[1]), text });
  }
  if (chunks.length) return chunks;
  for (const m of String(xml).matchAll(/<p\b[^>]*\bt="(\d+)"[^>]*>([\s\S]*?)<\/p>/g)) {
    const text = clean(m[2]);
    if (text) chunks.push({ start: Number(m[1]) / 1000, text });
  }
  return chunks;
}

/** Escolhe a legenda: português feita por pessoas > português automática > outra feita por pessoas > qualquer uma. */
export function pickCaptionTrack(tracks = []) {
  const pt = (t) => /^pt/i.test(t.languageCode || '');
  const human = (t) => t.kind !== 'asr';
  return (
    tracks.find((t) => pt(t) && human(t)) || tracks.find(pt) || tracks.find(human) || tracks[0] || null
  );
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// Clientes da API interna do YouTube, tentados em ordem: cada um às vezes devolve as legendas
// quando outro é bloqueado (o YouTube costuma bloquear servidores de nuvem pedindo login).
const PLAYER_CLIENTS = [
  {
    name: 'ANDROID',
    ua: 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip',
    client: { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'pt', gl: 'BR' },
  },
  {
    name: 'IOS',
    ua: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)',
    client: { clientName: 'IOS', clientVersion: '20.10.4', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82', hl: 'pt', gl: 'BR' },
  },
  {
    name: 'TVHTML5_EMBEDDED',
    ua: BROWSER_UA,
    client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'pt', gl: 'BR' },
    thirdParty: true,
  },
];

const captionTracksOf = (data) => data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];

/** Situação devolvida pelo YouTube (OK, LOGIN_REQUIRED "confirme que não é um robô", UNPLAYABLE…). */
const statusOf = (data) => ({
  status: data?.playabilityStatus?.status || 'SEM_RESPOSTA',
  reason: data?.playabilityStatus?.reason || data?.playabilityStatus?.messages?.join(' ') || '',
});

/**
 * Procura a resposta do player com legendas, tentando os clientes da API e depois a página do vídeo.
 * Devolve { data, attempts } — attempts registra o que cada tentativa recebeu, para explicar falhas.
 */
async function findPlayerResponse(id, fetchImpl) {
  const attempts = [];
  let best = null;
  for (const c of PLAYER_CLIENTS) {
    try {
      const res = await fetchImpl('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'User-Agent': c.ua, 'Accept-Language': 'pt-BR,pt;q=0.9' },
        body: JSON.stringify({
          context: { client: c.client, ...(c.thirdParty ? { thirdParty: { embedUrl: watchUrl(id) } } : {}) },
          videoId: id,
          contentCheckOk: true,
          racyCheckOk: true,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        attempts.push({ via: c.name, status: `HTTP ${res.status}`, reason: '' });
        continue;
      }
      const data = await res.json();
      attempts.push({ via: c.name, ...statusOf(data), tracks: captionTracksOf(data).length });
      if (captionTracksOf(data).length) return { data, attempts };
      if (!best && data?.videoDetails) best = data;
    } catch (err) {
      attempts.push({ via: c.name, status: 'ERRO', reason: err.cause?.code || err.message });
    }
  }
  // Página do vídeo: o mesmo JSON vem embutido em ytInitialPlayerResponse.
  try {
    const res = await fetchImpl(`${watchUrl(id)}&hl=pt-BR`, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
      signal: AbortSignal.timeout(20_000),
    });
    const html = await res.text();
    const marker = 'ytInitialPlayerResponse = ';
    const start = html.indexOf(marker);
    if (start >= 0) {
      const from = start + marker.length;
      const end = html.indexOf(';</script>', from);
      const data = JSON.parse(html.slice(from, end > 0 ? end : undefined));
      attempts.push({ via: 'PAGINA', ...statusOf(data), tracks: captionTracksOf(data).length });
      if (captionTracksOf(data).length) return { data, attempts };
      best ||= data?.videoDetails ? data : null;
    } else {
      attempts.push({ via: 'PAGINA', status: /consent|captcha|sorry/i.test(html) ? 'BLOQUEIO' : 'SEM_DADOS', reason: '' });
    }
  } catch (err) {
    attempts.push({ via: 'PAGINA', status: 'ERRO', reason: err.cause?.code || err.message });
  }
  return { data: best, attempts };
}

/**
 * Por que não deu para ler as legendas:
 * 'bloqueado' (o YouTube pediu login/confirmação de que não é robô — comum em servidores de nuvem),
 * 'sem_legendas' (o vídeo respondeu normalmente, mas não tem legendas) ou 'erro' (falha de rede ou outra).
 */
export function explainCaptionFailure(attempts = []) {
  const blocked = attempts.some((a) => a.status === 'LOGIN_REQUIRED' || a.status === 'BLOQUEIO' || /bot|robô|sign in|faça login/i.test(a.reason));
  const answeredOk = attempts.some((a) => a.status === 'OK');
  if (answeredOk && !blocked) return 'sem_legendas';
  if (blocked) return 'bloqueado';
  return 'erro';
}

/** Cliente do YouTube usado pela plataforma (título, duração e legendas). */
export function createYouTubeClient({ fetchImpl = fetch } = {}) {
  return {
    /** Título e canal do vídeo (oEmbed). Lança erro se o vídeo não existir ou for privado. */
    async info(id) {
      const res = await fetchImpl(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watchUrl(id))}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Este vídeo é privado ou não permite ser incorporado.'), { status: 400 });
      if (res.status === 404 || res.status === 400) throw Object.assign(new Error('Vídeo do YouTube não encontrado.'), { status: 400 });
      if (!res.ok) throw new Error(`YouTube respondeu ${res.status}`);
      const data = await res.json();
      return { title: data.title || '', channel: data.author_name || '' };
    },

    /** Transcrição a partir das legendas do vídeo: { chunks: [{start, text}], duration, language, automatic }. */
    async transcript(id) {
      const { data, attempts } = await findPlayerResponse(id, fetchImpl);
      const duration = Number(data?.videoDetails?.lengthSeconds) || null;
      const track = pickCaptionTrack(captionTracksOf(data));
      const summary = attempts.map((a) => `${a.via}: ${a.status}${a.reason ? ` (${a.reason})` : ''}${a.tracks ? `, ${a.tracks} legenda(s)` : ''}`).join(' | ');
      if (!track?.baseUrl) {
        return { chunks: [], duration, language: null, automatic: false, failure: explainCaptionFailure(attempts), attempts: summary };
      }
      const url = track.baseUrl.replace(/&fmt=[^&]*/, '');
      const res = await fetchImpl(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20_000) }).catch(() => null);
      const chunks = res?.ok ? parseCaptionXml(await res.text()) : [];
      return {
        chunks,
        duration,
        language: track.languageCode,
        automatic: track.kind === 'asr',
        ...(chunks.length ? {} : { failure: 'erro', attempts: `${summary} | legenda: ${res ? `HTTP ${res.status}, vazia` : 'falha de rede'}` }),
      };
    },

    /**
     * Baixa só o áudio com o yt-dlp (se estiver instalado no servidor), para transcrever com o Whisper
     * quando o vídeo não tem legendas. Devolve o caminho do arquivo e uma função para apagá-lo.
     */
    async downloadAudio(id) {
      const bin = process.env.YTDLP_PATH || 'yt-dlp';
      const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'kb-yt-'));
      const cleanup = () => fs.promises.rm(dir, { recursive: true, force: true });
      const code = await new Promise((resolve) => {
        const proc = spawn(bin, ['-f', 'bestaudio/best', '--no-playlist', '-o', path.join(dir, 'audio.%(ext)s'), watchUrl(id)]);
        proc.on('error', () => resolve(-1));
        proc.on('close', resolve);
      });
      const file = code === 0 ? (await fs.promises.readdir(dir)).map((f) => path.join(dir, f))[0] : null;
      if (!file) {
        await cleanup();
        return null;
      }
      return { file, cleanup };
    },
  };
}
