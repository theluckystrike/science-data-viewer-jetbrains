// Worker thread: owns the open file. HDF5 calls are synchronous, so they run here and never block the extension host.
import { parentPort, workerData } from 'node:worker_threads';
import { NetCDFReader } from 'netcdfjs';
import { openFile } from './core/open.mjs';
import { readSeries } from './core/series.mjs';

let h5p;
const libs = {
  NetCDFReader,
  h5wasm: async () => {
    if (!h5p) h5p = import('h5wasm/node').then(async m => { const h = m.default || m; await h.ready; return h; });
    return h5p;
  },
};

let opened = null, openErr = null;
const ready = openFile(workerData.filePath, libs, workerData.opts || {}).then(o => { opened = o; }, e => { openErr = e; });

parentPort.on('message', async msg => {
  await ready;
  const reply = (ok, data) => parentPort.postMessage({ id: msg.id, ok, ...(ok ? { data } : { error: data }) });
  try {
    if (msg.op === 'open') {
      if (openErr) return reply(false, openErr.message);
      return reply(true, { format: opened.backend.format, label: opened.backend.label, size: opened.sniff.size });
    }
    if (openErr) return reply(false, openErr.message);
    const b = opened.backend;
    if (msg.op === 'list') return reply(true, b.list(msg.path));
    if (msg.op === 'info') return reply(true, b.info(msg.path));
    if (msg.op === 'read') return reply(true, b.read(msg.path, msg.view, msg.decode));
    if (msg.op === 'series') return reply(true, readSeries(b, msg.path, msg.axis, msg.index || [], msg.decode !== false, { maxReadValues: (workerData.opts || {}).maxReadValues }));
    if (msg.op === 'close') { b.close(); return reply(true, null); }
    reply(false, 'unknown op');
  } catch (e) {
    reply(false, String(e && e.message || e));
  }
});
