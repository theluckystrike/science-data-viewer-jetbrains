// One session per open editor: validates webview messages, relays them to the worker thread,
// enforces a timeout per read, and restarts the worker when a read hangs.
import { validateRequest, DEFAULT_LIMITS, decodePngDataUrl } from './protocol.mjs';
import { toCsv, toJson, exportFileName } from './export.mjs';

export class Session {
  /**
   * chooseExportFile({ defaultName }) -> { path, format: 'csv' | 'json' } or null; writeExport(path, text) -> Promise.
   * choosePngFile({ defaultName }) -> { path } or null; writePng(path, bytes) -> Promise. ui: settings for the webview (colormap).
   */
  constructor({ createWorker, post, copy, limits = DEFAULT_LIMITS, timeoutMs = 20000, fileName, chooseExportFile, writeExport, choosePngFile, writePng, ui }) {
    Object.assign(this, { createWorker, post, copy, limits, timeoutMs, fileName, chooseExportFile, writeExport, choosePngFile, writePng, ui });
    this.seq = 1; this.calls = new Map(); this.worker = null; this.disposed = false; this.opened = null;
  }

  spawn() {
    const w = this.createWorker();
    this.worker = w;
    w.on('message', m => { const c = this.calls.get(m.id); if (!c) return; this.calls.delete(m.id); clearTimeout(c.timer); m.ok ? c.resolve(m.data) : c.reject(new Error(m.error)); });
    w.on('error', e => this.failAll(w, 'The reader stopped: ' + e.message));
    w.on('exit', () => this.failAll(w, 'The reader stopped.'));
    this.opened = this.call('open', {});
    return this.opened;
  }

  failAll(w, msg) {
    if (this.worker !== w) return;
    for (const c of this.calls.values()) { clearTimeout(c.timer); c.reject(new Error(msg)); }
    this.calls.clear();
    this.worker = null;
  }

  call(op, payload) {
    if (!this.worker) this.spawn();
    const id = this.seq++;
    const w = this.worker;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error(`This read took longer than ${Math.round(this.timeoutMs / 1000)} s and was stopped. Try a smaller slice; very large chunks must be read whole.`));
        if (this.worker === w) { this.worker = null; w.terminate(); }
      }, this.timeoutMs);
      this.calls.set(id, { resolve, reject, timer });
      w.postMessage({ id, op, ...payload });
    });
  }

  /** Called with the init message data once the webview says ready. */
  async init() {
    try {
      const o = await (this.opened || this.spawn());
      return { type: 'init', fileName: this.fileName, format: o.format, label: o.label, size: o.size, ...(this.ui ? { ui: this.ui } : {}) };
    } catch (e) {
      return { type: 'init', fileName: this.fileName, error: e.message };
    }
  }

  async handle(msg) {
    if (this.disposed) return;
    const v = validateRequest(msg, this.limits);
    if (!v.ok) {
      if (msg && Number.isInteger(msg.reqId)) this.post({ type: 'result', reqId: msg.reqId, ok: false, error: v.error });
      return;
    }
    const r = v.req;
    if (r.type === 'ready') { this.post(await this.init()); return; }
    if (r.type === 'copy') { if (this.copy) await this.copy(r.text); return; }
    if (r.type === 'savePng') {
      try { this.post({ type: 'result', reqId: r.reqId, ok: true, data: await this.savePng(r) }); } catch (e) { this.post({ type: 'result', reqId: r.reqId, ok: false, error: e.message }); }
      return;
    }
    try {
      if (!this.worker) await this.spawn();
      if (r.type === 'export') { this.post({ type: 'result', reqId: r.reqId, ok: true, data: await this.exportSlice(r) }); return; }
      if (r.type === 'series') { this.post({ type: 'result', reqId: r.reqId, ok: true, data: await this.call('series', { path: r.path, axis: r.axis, index: r.index, decode: r.decode }) }); return; }
      const data = await this.call(r.type, r.type === 'read' ? { path: r.path, view: r.view, decode: r.decode } : { path: r.path });
      this.post({ type: 'result', reqId: r.reqId, ok: true, data });
    } catch (e) {
      this.post({ type: 'result', reqId: r.reqId, ok: false, error: e.message });
    }
  }

  /** Reads the whole slice on screen (all rows and columns of the two chosen dimensions) and saves it. */
  async exportSlice(r) {
    if (!this.chooseExportFile || !this.writeExport) throw new Error('Export is not available here.');
    const info = await this.call('info', { path: r.path });
    if (info.kind !== 'dataset') throw new Error('Pick a variable to export.');
    const shape = info.shape || [], nd = shape.length;
    const rowAxis = nd ? r.view.rowAxis : 0;
    const colAxis = nd >= 2 && !info.compound ? r.view.colAxis : -1;
    if (nd && (rowAxis >= nd || colAxis >= nd)) throw new Error('This variable has ' + nd + ' dimensions.');
    const index = shape.map((n, d) => Math.min(Math.max(0, n - 1), r.view.index[d] || 0));
    const rows = nd ? shape[rowAxis] : 1, cols = colAxis >= 0 ? shape[colAxis] : 1;
    const total = rows * cols;
    if (total > this.limits.maxReadValues) {
      throw new Error(`This slice has ${total} values. Export is limited to ${this.limits.maxReadValues} (setting hdf5NetcdfExplorer.maxReadValues). Pick other row and column dimensions or raise the setting.`);
    }
    const view = { rowAxis, colAxis, index };
    const pick = await this.chooseExportFile({ defaultName: exportFileName(info, view, 'csv') });
    if (!pick) return { cancelled: true };
    const data = nd === 0 ? await this.call('read', { path: r.path, view: { rowAxis: 0, colAxis: -1, index: [] }, decode: r.decode })
      : await this.call('read', { path: r.path, view: { ...view, rowStart: 0, rowCount: rows, colStart: 0, colCount: cols, rowStep: 1, colStep: 1 }, decode: r.decode });
    const coord = async (d, start, count) => {
      const c = info.coords && info.coords[d];
      if (!c) return null;
      try {
        const x = await this.call('read', { path: c, view: { rowAxis: 0, colAxis: -1, index: [], rowStart: start, rowCount: count }, decode: true });
        const values = new Array(start).concat(x.values.map(v => v[0]));
        const times = x.times ? new Array(start).concat(x.times.map(v => v[0])) : null;
        return { values, times };
      } catch { return null; }
    };
    const rowCoord = nd ? await coord(rowAxis, 0, rows) : null;
    const colCoord = colAxis >= 0 ? await coord(colAxis, 0, cols) : null;
    const fixed = [];
    for (let d = 0; d < nd; d++) {
      if (d === rowAxis || d === colAxis) continue;
      const c = await coord(d, index[d], 1);
      const value = c ? (c.times && c.times[index[d]] != null ? c.times[index[d]] : c.values[index[d]]) : null;
      fixed.push({ dim: info.dims[d], index: index[d], value: value === undefined ? null : value });
    }
    const slice = { info, view, data, rowCoord, colCoord, fixed, fileName: this.fileName };
    const text = pick.format === 'json' ? toJson(slice) : toCsv(slice);
    await this.writeExport(pick.path, text);
    return { file: pick.path, format: pick.format, rows: data.rows, cols: data.cols, bytes: Buffer.byteLength(text) };
  }

  /** Checks the picture is a PNG, asks where to save it (next to the source file) and writes it. */
  async savePng(r) {
    if (!this.choosePngFile || !this.writePng) throw new Error('Save PNG is not available here.');
    let bytes;
    try { bytes = decodePngDataUrl(r.dataUrl); } catch (e) { throw new Error('The picture could not be saved: ' + e.message + '.'); }
    const pick = await this.choosePngFile({ defaultName: r.name });
    if (!pick) return { cancelled: true };
    await this.writePng(pick.path, bytes);
    return { file: pick.path, bytes: bytes.length };
  }

  async reload() {
    const w = this.worker; this.worker = null;
    if (w) { this.failAll(w, 'reloaded'); await w.terminate(); }
    this.opened = null;
    this.post({ type: 'reload' });
  }

  dispose() {
    this.disposed = true;
    const w = this.worker; this.worker = null;
    if (w) { this.failAll(w, 'closed'); w.terminate(); }
  }
}
