// Synchronous byte-range reads from the plugin's private origin. Only used inside the Web Worker,
// where synchronous XHR with an ArrayBuffer response is allowed. The host answers
// GET /t/<token>/file?offset=&length= with exactly those bytes (416 past the end of the file).
export function fileUrl(token) { return '/t/' + encodeURIComponent(token) + '/file'; }

export function readRangeSync(token, offset, length) {
  if (length === 0) return new Uint8Array(0);
  const xhr = new XMLHttpRequest();
  xhr.open('GET', fileUrl(token) + '?offset=' + offset + '&length=' + length, false);
  xhr.responseType = 'arraybuffer';
  xhr.send(null);
  if (xhr.status !== 200 && xhr.status !== 206) throw new Error('Could not read bytes ' + offset + '-' + (offset + length) + ' (HTTP ' + xhr.status + ').');
  const out = new Uint8Array(xhr.response || new ArrayBuffer(0));
  if (out.length !== length) throw new Error('Short read: wanted ' + length + ' bytes at ' + offset + ', got ' + out.length + '.');
  return out;
}

export function metaSync(token) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', '/t/' + encodeURIComponent(token) + '/meta', false);
  xhr.send(null);
  if (xhr.status !== 200) throw new Error('The file is no longer open (HTTP ' + xhr.status + ').');
  return JSON.parse(xhr.responseText);
}

/** Async read for the main thread (NumPy viewer). */
export async function readRange(token, offset, length) {
  if (length === 0) return new Uint8Array(0);
  const r = await fetch(fileUrl(token) + '?offset=' + offset + '&length=' + length);
  if (!r.ok) throw new Error('Could not read bytes ' + offset + '-' + (offset + length) + ' (HTTP ' + r.status + ').');
  const out = new Uint8Array(await r.arrayBuffer());
  if (out.length !== length) throw new Error('Short read: wanted ' + length + ' bytes at ' + offset + ', got ' + out.length + '.');
  return out;
}
