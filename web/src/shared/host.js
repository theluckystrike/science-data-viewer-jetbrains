// Page side of the JetBrains host. Replaces acquireVsCodeApi(): requests go to the plugin's private
// origin (/t/<token>/...), which only the editor that opened the file knows.
const Z = window.ZOVO || {};
export const token = Z.token;
export const fileName = Z.name;
export const fileSize = Z.size;

async function post(path, body) {
  const r = await fetch('/t/' + encodeURIComponent(token) + '/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
  if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
  return data;
}

export const host = {
  copy: text => post('copy', { text }),
  /** Shows the IDE save dialog. kind: 'text' (data is a string) or 'base64'. Returns { file } or { cancelled: true }. */
  save: (name, kind, data, filters) => post('save', { name, kind, data, filters }),
  open: url => post('open', { url }),
};

/** The webview state API, kept per file type in localStorage. */
export function vscodeApi(onMessage) {
  const key = 'zovo-state-' + (Z.kind || 'view');
  return {
    postMessage: m => { onMessage(m); },
    getState: () => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } },
    setState: s => { try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* storage off */ } return s; },
  };
}

export function deliver(msg) { window.dispatchEvent(new MessageEvent('message', { data: msg })); }

// Links open in the system browser, never inside the editor tab.
document.addEventListener('click', ev => {
  const a = ev.target && ev.target.closest && ev.target.closest('a[href]');
  if (!a) return;
  const href = a.getAttribute('href');
  if (/^https:\/\//.test(href)) { ev.preventDefault(); host.open(href).catch(() => {}); }
  else if (!href.startsWith('#')) ev.preventDefault();
}, true);

export function bytesToBase64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
