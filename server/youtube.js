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

const ANDROID_CLIENT = { clientName: 'ANDROID', clientVersion: '20.10.38', androidSdkVersion: 30, hl: 'pt', gl: 'BR' };
const ANDROID_UA = 'com.google.android.youtube/20.10.38 (Linux; U; Android 11) gzip';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function playerResponse(id, fetchImpl) {
  // 1) API interna usada pelo app do YouTube (costuma trazer as legendas sem bloqueio).
  try {
    const res = await fetchImpl('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ANDROID_UA },
      body: JSON.stringify({ context: { client: ANDROID_CLIENT }, videoId: id }),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data?.captions || data?.videoDetails) return data;
    }
  } catch {
    /* tenta pela página do vídeo */
  }
  // 2) Página do vídeo: o mesmo JSON vem embutido em ytInitialPlayerResponse.
  const res = await fetchImpl(`${watchUrl(id)}&hl=pt-BR`, {
    headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'pt-BR,pt;q=0.9' },
    signal: AbortSignal.timeout(20_000),
  });
  const html = await res.text();
  const start = html.indexOf('ytInitialPlayerResponse = ');
  if (start < 0) return null;
  const from = start + 'ytInitialPlayerResponse = '.length;
  const end = html.indexOf(';</script>', from);
  try {
    return JSON.parse(html.slice(from, end > 0 ? end : undefined));
  } catch {
    return null;
  }
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
      const data = await playerResponse(id, fetchImpl);
      const duration = Number(data?.videoDetails?.lengthSeconds) || null;
      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
      const track = pickCaptionTrack(tracks);
      if (!track?.baseUrl) return { chunks: [], duration, language: null, automatic: false };
      const url = track.baseUrl.replace(/&fmt=[^&]*/, '');
      const res = await fetchImpl(url, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20_000) });
      const chunks = res.ok ? parseCaptionXml(await res.text()) : [];
      return { chunks, duration, language: track.languageCode, automatic: track.kind === 'asr' };
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
