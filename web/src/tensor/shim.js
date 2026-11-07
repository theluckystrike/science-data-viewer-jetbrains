// Replaces the VS Code extension host for the NumPy viewer: the same core modules run in the page and
// read the file by byte range from the plugin's private origin.
const { openTensorFile } = require('./core/formats');
const { sampleTensor } = require('./core/sample');
const { validateWebviewMessage, publicModel, shapeText } = require('./core/protocol');
const { readValues, sliceTensor, pageText, planExport, writeExport, exportName } = require('./core/values');
const { readImage } = require('./core/image');
const { host, vscodeApi, deliver, fileName, fileSize, token, bytesToBase64 } = require('../shared/host.js');
const { readRange } = require('../shared/range-read.js');

class HttpSource {
  constructor(size) { this.size = size; this.random = true; }
  read(offset, length) {
    if (offset < 0 || length < 0 || offset + length > this.size) return Promise.reject(new RangeError(`Read past the end of the file (offset ${offset}, length ${length}, size ${this.size}).`));
    return readRange(token, offset, length);
  }
  async close() {}
}

const SAMPLE_VALUES = 2000000;
const EXPORT_MAX = 256 * 1048576;
const b64 = typed => bytesToBase64(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
const sizeText = n => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`;

const t0 = Date.now();
const modelP = openTensorFile(new HttpSource(fileSize), fileName, {});
modelP.catch(() => {});
let seq = 0;

async function exportTensor(t, format, slice) {
  let plan;
  try { plan = planExport(t, format, slice); } catch (e) { return { ok: false, text: e.message || String(e) }; }
  const chunks = []; let written = 0;
  const done = await writeExport(plan, async buf => {
    written += buf.length;
    if (written > EXPORT_MAX) throw new Error('Export from the IDE stops at 256 MB. Use NumPy for larger arrays.');
    chunks.push(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice());
  }, {});
  if (!done) return { ok: false, text: 'Saving was cancelled. Nothing was written.' };
  const all = new Uint8Array(written); let o = 0;
  for (const c of chunks) { all.set(c, o); o += c.length; }
  const r = await host.save(exportName(t.name, plan.label, format), 'base64', bytesToBase64(all), [format]);
  if (r.cancelled) return { ok: false, text: 'Not saved.' };
  return { ok: true, text: `Saved ${r.file.split(/[\\/]/).pop()} (${sizeText(written)}).${plan.note ? ' ' + plan.note : ''}` };
}

async function handle(raw) {
  if (raw && raw.type === 'ready') {
    try { const model = await modelP; deliver({ ...publicModel(model, fileName), openMs: Date.now() - t0 }); }
    catch (e) { deliver({ type: 'error', message: e.message || String(e) }); }
    return;
  }
  let model;
  try { model = await modelP; } catch { return; }
  const v = validateWebviewMessage(raw, model.tensors.length, model.tensors);
  if (!v.ok) return;
  const msg = v.msg;
  if (msg.type === 'image') {
    const req = { layout: msg.layout, frame: msg.frame, range: msg.range };
    try { deliver({ type: 'image', index: msg.index, req, result: await readImage(model.tensors[msg.index], req) }); }
    catch (e) { deliver({ type: 'imageError', index: msg.index, req, message: e.message || String(e) }); }
    return;
  }
  if (msg.type === 'select') {
    const my = ++seq; const slice = msg.slice || null;
    try {
      const t = slice ? sliceTensor(model.tensors[msg.index], slice) : model.tensors[msg.index];
      const result = await sampleTensor(t, { sampleValues: SAMPLE_VALUES });
      if (my === seq) deliver({ type: 'sample', index: msg.index, slice, result });
    } catch (e) { if (my === seq) deliver({ type: 'sampleError', index: msg.index, slice, message: e.message || String(e) }); }
    return;
  }
  if (msg.type === 'values') {
    try {
      const r = await readValues(model.tensors[msg.index], msg);
      deliver({ type: 'values', index: msg.index, slice: r.slice, row: r.row, col: r.col, rows: r.rows, cols: r.cols, totalRows: r.totalRows, totalCols: r.totalCols, kind: r.kind, re: b64(r.re), im: r.im ? b64(r.im) : null });
    } catch (e) { deliver({ type: 'valuesError', index: msg.index, slice: msg.slice, row: msg.row, col: msg.col, message: e.message || String(e) }); }
    return;
  }
  if (msg.type === 'copyValues') {
    try {
      const text = pageText(await readValues(model.tensors[msg.index], msg));
      if (text.length > 1000000) throw new Error('This page is too long to copy.');
      await host.copy(text);
      deliver({ type: 'copied', what: 'values', text: `${msg.rows} x ${msg.cols} values` });
    } catch (e) { deliver({ type: 'copied', what: 'error', text: e.message || String(e) }); }
    return;
  }
  if (msg.type === 'export') {
    let r;
    try { r = await exportTensor(model.tensors[msg.index], msg.format, msg.slice); } catch (e) { r = { ok: false, text: e.message || String(e) }; }
    deliver({ type: 'exported', ok: r.ok, text: r.text });
    return;
  }
  if (msg.type === 'copy') {
    const text = shapeText(model.tensors[msg.index], msg.what);
    await host.copy(text);
    deliver({ type: 'copied', what: msg.what, text });
  }
}

window.acquireVsCodeApi = () => vscodeApi(m => { handle(m); });
