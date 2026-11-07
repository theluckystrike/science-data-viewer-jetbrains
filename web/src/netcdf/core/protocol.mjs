// Validates messages from the webview. The webview is treated as untrusted input:
// every field is type-checked and clamped before it reaches the worker.

export const DEFAULT_LIMITS = { maxReadValues: 1_000_000, maxPathLength: 4096, maxDims: 32, maxPage: 2000 };
// "Save PNG": the picture comes as a data URL. 40 MB of text is far more than a 2x plot needs.
export const MAX_PNG_DATA_URL = 40 * 1024 * 1024;
export const PNG_PREFIX = 'data:image/png;base64,';
// Copy as CSV of a series (up to 100,000 points) needs more than a code snippet does.
export const MAX_COPY_TEXT = 4_000_000;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Base64 PNG data URL -> Buffer of the PNG bytes, or throws with a reason. Used by the host before it writes the file. */
export function decodePngDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PNG_PREFIX)) throw new Error('not a PNG data URL');
  if (dataUrl.length > MAX_PNG_DATA_URL) throw new Error('picture too large');
  const b64 = dataUrl.slice(PNG_PREFIX.length);
  if (b64.length < 12 || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) throw new Error('bad base64');
  const bytes = Buffer.from(b64, 'base64');
  if (bytes.length < PNG_MAGIC.length || !PNG_MAGIC.every((b, i) => bytes[i] === b)) throw new Error('not a PNG picture');
  return bytes;
}

/** Suggested file name for a picture: safe characters only, ends in .png. */
export function pngFileName(name) {
  let base = String(name || '').replace(/\.png$/i, '').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[._-]+/, '').slice(0, 120);
  if (!base) base = 'plot';
  return base + '.png';
}

const isStr = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;
const int = (v, lo, hi, dflt) => { if (v === undefined) return dflt; if (!Number.isInteger(v) || v < lo || v > hi) throw new Error('bad number'); return v; };

/** Returns { ok: true, req } or { ok: false, error }. */
export function validateRequest(msg, limits = DEFAULT_LIMITS) {
  try {
    if (!msg || typeof msg !== 'object') throw new Error('not an object');
    switch (msg.type) {
      case 'ready': return { ok: true, req: { type: 'ready' } };
      case 'copy':
        if (typeof msg.text !== 'string' || msg.text.length > MAX_COPY_TEXT) throw new Error('bad text');
        return { ok: true, req: { type: 'copy', text: msg.text } };
      case 'list': case 'info': {
        const reqId = int(msg.reqId, 0, 2 ** 31, undefined);
        if (reqId === undefined) throw new Error('missing reqId');
        if (!isStr(msg.path, limits.maxPathLength) || msg.path[0] !== '/') throw new Error('bad path');
        return { ok: true, req: { type: msg.type, reqId, path: msg.path } };
      }
      case 'read': {
        const reqId = int(msg.reqId, 0, 2 ** 31, undefined);
        if (reqId === undefined) throw new Error('missing reqId');
        if (!isStr(msg.path, limits.maxPathLength) || msg.path[0] !== '/') throw new Error('bad path');
        const v = msg.view || {};
        const BIG = Number.MAX_SAFE_INTEGER;
        const index = Array.isArray(v.index) ? v.index : [];
        if (index.length > limits.maxDims || !index.every(x => Number.isInteger(x) && x >= 0 && x <= BIG)) throw new Error('bad index');
        const view = {
          rowAxis: int(v.rowAxis, 0, limits.maxDims - 1, 0),
          colAxis: int(v.colAxis, -1, limits.maxDims - 1, -1),
          index,
          rowStart: int(v.rowStart, 0, BIG, 0), rowCount: int(v.rowCount, 0, BIG, 100),
          colStart: int(v.colStart, 0, BIG, 0), colCount: int(v.colCount, 0, BIG, 1),
          rowStep: int(v.rowStep, 1, BIG, 1), colStep: int(v.colStep, 1, BIG, 1),
        };
        // Count the values actually read: a sampled plot reads every rowStep-th row and colStep-th column.
        const nValues = Math.ceil(view.rowCount / view.rowStep) * Math.max(1, Math.ceil(view.colCount / view.colStep));
        if (nValues > limits.maxReadValues) {
          return { ok: false, error: `This read asks for ${nValues} values. The limit is ${limits.maxReadValues}.` };
        }
        return { ok: true, req: { type: 'read', reqId, path: msg.path, view, decode: msg.decode !== false, purpose: msg.purpose === 'plot' ? 'plot' : 'table' } };
      }
      case 'export': {
        // Export the whole slice that is on screen. Only the axes and the fixed indices come from the webview;
        // the host reads the shape itself, and the user picks the file in a save dialog.
        const reqId = int(msg.reqId, 0, 2 ** 31, undefined);
        if (reqId === undefined) throw new Error('missing reqId');
        if (!isStr(msg.path, limits.maxPathLength) || msg.path[0] !== '/') throw new Error('bad path');
        const v = msg.view || {};
        const index = Array.isArray(v.index) ? v.index : [];
        if (index.length > limits.maxDims || !index.every(x => Number.isInteger(x) && x >= 0 && x <= Number.MAX_SAFE_INTEGER)) throw new Error('bad index');
        const view = { rowAxis: int(v.rowAxis, 0, limits.maxDims - 1, 0), colAxis: int(v.colAxis, -1, limits.maxDims - 1, -1), index };
        if (view.colAxis === view.rowAxis) throw new Error('bad axes');
        return { ok: true, req: { type: 'export', reqId, path: msg.path, view, decode: msg.decode !== false } };
      }
      case 'savePng': {
        // The webview drew the picture; the host checks it is a PNG and asks where to save it.
        const reqId = int(msg.reqId, 0, 2 ** 31, undefined);
        if (reqId === undefined) throw new Error('missing reqId');
        const d = msg.dataUrl;
        if (typeof d !== 'string' || !d.startsWith(PNG_PREFIX)) throw new Error('bad picture');
        if (d.length > MAX_PNG_DATA_URL) throw new Error('picture too large');
        // The first 12 base64 characters are the 8-byte PNG signature (plus one byte).
        const head = Buffer.from(d.slice(PNG_PREFIX.length, PNG_PREFIX.length + 12), 'base64');
        if (head.length < 8 || !PNG_MAGIC.every((b, i) => head[i] === b)) throw new Error('not a PNG picture');
        if (msg.name !== undefined && (typeof msg.name !== 'string' || msg.name.length > 200)) throw new Error('bad name');
        return { ok: true, req: { type: 'savePng', reqId, dataUrl: d, name: pngFileName(msg.name) } };
      }
      case 'series': {
        // Values along one dimension at a fixed point (the clicked heatmap cell and the slider indices).
        const reqId = int(msg.reqId, 0, 2 ** 31, undefined);
        if (reqId === undefined) throw new Error('missing reqId');
        if (!isStr(msg.path, limits.maxPathLength) || msg.path[0] !== '/') throw new Error('bad path');
        const axis = int(msg.axis, 0, limits.maxDims - 1, undefined);
        if (axis === undefined) throw new Error('missing axis');
        const index = Array.isArray(msg.index) ? msg.index : [];
        if (index.length > limits.maxDims || !index.every(x => Number.isInteger(x) && x >= 0 && x <= Number.MAX_SAFE_INTEGER)) throw new Error('bad index');
        return { ok: true, req: { type: 'series', reqId, path: msg.path, axis, index, decode: msg.decode !== false } };
      }
      default: throw new Error('unknown type');
    }
  } catch (e) {
    return { ok: false, error: 'Invalid request: ' + e.message };
  }
}
