export function toUrlString(url) {
  if (typeof url === 'string') return url;
  if (url instanceof URL) return url.href;
  if (url && typeof url === 'object' && 'href' in url) return String(url.href || '');
  if (url == null) return '';
  return String(url);
}

export function toWebSocketUrl(url) {
  const urlStr = toUrlString(url);
  if (!urlStr) return '';
  if (urlStr.startsWith('ws://') || urlStr.startsWith('wss://')) return urlStr;
  if (urlStr.startsWith('http://')) return `ws://${urlStr.slice('http://'.length)}`;
  if (urlStr.startsWith('https://')) return `wss://${urlStr.slice('https://'.length)}`;
  return urlStr;
}
