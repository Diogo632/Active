/**
 * Gravações do Teams: ficam no OneDrive/SharePoint da empresa e só abrem para quem está logado na conta
 * Microsoft. A plataforma guarda o link (para abrir no SharePoint) e, se informado, o endereço do player
 * do "Código de inserção" (para assistir dentro da plataforma). A transcrição é baixada do Teams e enviada.
 */

// Só endereços da Microsoft: o player vai num iframe e o link vira botão na página.
const SHAREPOINT_HOST = /^[a-z0-9-]+(-my)?\.sharepoint\.com$/i;
const TEAMS_HOST = /^(teams\.microsoft\.com|teams\.cloud\.microsoft|teams\.live\.com)$/i;

function toUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    return url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Endereço do player a partir do código de inserção (<iframe src="…">) ou do próprio endereço embed.aspx. */
export function parseEmbed(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const src = raw.match(/src\s*=\s*["']([^"']+)["']/i)?.[1]?.replace(/&amp;/g, '&') || raw;
  const url = toUrl(src);
  if (!url || !SHAREPOINT_HOST.test(url.hostname) || !/\/_layouts\/15\/embed\.aspx$/i.test(url.pathname)) return null;
  return url.href;
}

/** Link da gravação (Copiar link do SharePoint/Stream ou do Teams). */
export function parseRecordingLink(input) {
  const url = toUrl(input);
  if (!url || !(SHAREPOINT_HOST.test(url.hostname) || TEAMS_HOST.test(url.hostname))) return null;
  url.hash = '';
  return url.href;
}

/**
 * Título sugerido pelo nome do arquivo da gravação, quando o link traz o caminho
 * ("…/Recordings/Passagem de Bastão Transbig-20260909_130000-Gravação de Reunião.mp4").
 */
export function titleFromLink(link) {
  const url = toUrl(link);
  const path = url?.searchParams.get('id') || url?.pathname || '';
  const file = decodeURIComponent(path.split('/').pop() || '');
  if (!/\.(mp4|m4a|mov|webm)$/i.test(file)) return '';
  return file
    .replace(/\.(mp4|m4a|mov|webm)$/i, '')
    .replace(/-\d{8}_\d{6}.*$/, '')
    .replace(/[_]+/g, ' ')
    .trim();
}

/** Link que abre a gravação no SharePoint num momento (usado pelos capítulos e pela transcrição). */
export function linkAt(link, seconds) {
  const url = toUrl(link);
  if (!url || !SHAREPOINT_HOST.test(url.hostname)) return link;
  url.searchParams.delete('nav');
  const nav = encodeURIComponent(JSON.stringify({ playbackOptions: { startTimeInSeconds: Math.max(0, Math.floor(seconds)) } }));
  return `${url.href}${url.search ? '&' : '?'}nav=${nav}`;
}
