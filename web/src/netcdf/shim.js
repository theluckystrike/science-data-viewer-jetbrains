// Replaces the VS Code extension host for the NetCDF/HDF5 viewer. The unchanged Session class
// validates every webview message and relays it to a Web Worker that reads the file by range.
import { Session } from './core/session.mjs';
import { host, vscodeApi, deliver, fileName, token, bytesToBase64 } from '../shared/host.js';

class WorkerAdapter {
  constructor(url) {
    this.w = new Worker(url);
    this.handlers = { message: [], error: [], exit: [] };
    this.w.onmessage = ev => this.handlers.message.forEach(f => f(ev.data));
    this.w.onerror = ev => { ev.preventDefault(); this.handlers.error.forEach(f => f(new Error(ev.message || 'worker error'))); };
  }
  on(type, fn) { (this.handlers[type] || []).push(fn); return this; }
  postMessage(m) { this.w.postMessage(m); }
  terminate() { this.w.terminate(); this.handlers.exit.forEach(f => f(0)); return Promise.resolve(0); }
}

const MAX_READ = 1000000;
let lastPick = null;
const session = new Session({
  createWorker: () => new WorkerAdapter('/static/netcdf-worker.js?t=' + encodeURIComponent(token) + '&max=' + MAX_READ),
  post: m => deliver(m),
  copy: text => host.copy(text),
  fileName,
  timeoutMs: 60000,
  ui: { colormap: 'viridis' },
  chooseExportFile: async ({ defaultName }) => (lastPick = { path: defaultName, format: 'csv' }),
  writeExport: async (name, text) => {
    const r = await host.save(name, 'text', text, ['csv']);
    if (r.cancelled) throw new Error('Export cancelled.');
    if (lastPick) lastPick.path = r.file;
  },
  choosePngFile: async ({ defaultName }) => (lastPick = { path: defaultName }),
  writePng: async (name, bytes) => {
    const r = await host.save(name, 'base64', bytesToBase64(bytes), ['png']);
    if (r.cancelled) throw new Error('Save cancelled.');
    if (lastPick) lastPick.path = r.file;
  },
});

window.acquireVsCodeApi = () => vscodeApi(m => { session.handle(m); });
window.addEventListener('unload', () => session.dispose());
