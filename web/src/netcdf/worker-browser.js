// Web Worker: owns the open file, like src/worker.mjs does in the VS Code extension.
// The worker URL carries the file token: /static/netcdf-worker.js?t=<token>&max=<maxReadValues>.
import { NetCDFReader } from 'netcdfjs';
import * as h5 from 'h5wasm';
import { openFile } from './core/open.mjs';
import { readSeries } from './core/series.mjs';
import { mountRangeFile } from '../shared/lazy-file.js';
import { metaSync } from '../shared/range-read.js';

const q = new URLSearchParams(self.location.search);
const token = q.get('t') || '';
const opts = { maxReadValues: Number(q.get('max')) || 1000000 };
const filePath = '/zovo/' + token;

const libs = {
  NetCDFReader,
  h5wasm: async () => {
    const Module = await h5.ready;
    try { Module.FS.stat(filePath); } catch { mountRangeFile(Module.FS, '/zovo', token, token, metaSync(token).size); }
    return h5;
  },
};

let opened = null, openErr = null;
const ready = openFile(filePath, libs, opts).then(o => { opened = o; }, e => { openErr = e; });

self.onmessage = async ev => {
  const msg = ev.data;
  await ready;
  const reply = (ok, data) => self.postMessage({ id: msg.id, ok, ...(ok ? { data } : { error: data }) });
  try {
    if (msg.op === 'open') {
      if (openErr) return reply(false, (openErr.message || String(openErr)) + (q.get('debug') ? '\n' + openErr.stack : ''));
      return reply(true, { format: opened.backend.format, label: opened.backend.label, size: opened.sniff.size });
    }
    if (openErr) return reply(false, openErr.message || String(openErr));
    const b = opened.backend;
    if (msg.op === 'list') return reply(true, b.list(msg.path));
    if (msg.op === 'info') return reply(true, b.info(msg.path));
    if (msg.op === 'read') return reply(true, b.read(msg.path, msg.view, msg.decode));
    if (msg.op === 'series') return reply(true, readSeries(b, msg.path, msg.axis, msg.index || [], msg.decode !== false, { maxReadValues: opts.maxReadValues }));
    if (msg.op === 'close') { b.close(); return reply(true, null); }
    reply(false, 'unknown op');
  } catch (e) {
    reply(false, String(e && e.message || e));
  }
};
