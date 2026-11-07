import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { EventEmitter } from 'node:events';
import { Session } from '../../src/netcdf/core/session.mjs';
import { S } from './helpers.mjs';

const realWorker = file => () => new Worker(new URL('../../src/netcdf/worker.mjs', import.meta.url), { workerData: { filePath: S(file), opts: {} } });

test('webview protocol over a real worker: ready -> init, list/info/read -> result', async () => {
  const out = [];
  const s = new Session({ fileName: 'era5-t2m-sample.nc', post: m => out.push(m), createWorker: realWorker('era5-t2m-sample.nc') });
  try {
    await s.handle({ type: 'ready' });
    assert.deepEqual(out[0], { type: 'init', fileName: 'era5-t2m-sample.nc', format: 'hdf5', label: 'NetCDF-4 (HDF5)', size: 1337567 });
    await s.handle({ type: 'list', reqId: 1, path: '/' });
    assert.equal(out[1].type, 'result'); assert.equal(out[1].reqId, 1); assert.equal(out[1].ok, true);
    assert.ok(out[1].data.items.some(i => i.name === 't2m'));
    await s.handle({ type: 'read', reqId: 2, path: '/t2m', view: { rowAxis: 1, colAxis: 2, rowCount: 2, colCount: 2 } });
    assert.equal(out[2].ok, true); assert.equal(out[2].data.rows, 2);
    JSON.parse(JSON.stringify(out[2])); // JSON-safe
    await s.handle({ type: 'read', reqId: 3, path: '/missing', view: {} });
    assert.equal(out[3].ok, false); assert.match(out[3].error, /Not found|not/i);
    await s.handle({ type: 'read', reqId: 4, path: 'no-slash' });
    assert.deepEqual([out[4].reqId, out[4].ok], [4, false]);
    await s.handle({ type: 'unknown' }); // no reqId: ignored
    assert.equal(out.length, 5);
    let copied; s.copy = t => { copied = t; };
    await s.handle({ type: 'copy', text: 'ds["t2m"]' });
    assert.equal(copied, 'ds["t2m"]');
  } finally { s.dispose(); }
});

test('unsupported file: init carries the error', async () => {
  const out = [];
  const s = new Session({ fileName: 'x.json', post: m => out.push(m), createWorker: realWorker('expected.json') });
  try { await s.handle({ type: 'ready' }); assert.match(out[0].error, /not HDF5 or NetCDF/); } finally { s.dispose(); }
});

test('a hung read times out, the worker is killed and the next request respawns it', async () => {
  let spawned = 0, terminated = 0;
  const fake = () => {
    spawned++;
    const w = new EventEmitter();
    w.postMessage = m => { if (m.op === 'open') setImmediate(() => w.emit('message', { id: m.id, ok: true, data: { format: 'hdf5', label: 'HDF5', size: 1 } })); else if (m.path !== '/hang') setImmediate(() => w.emit('message', { id: m.id, ok: true, data: { echo: m.path } })); };
    w.terminate = async () => { terminated++; };
    return w;
  };
  const out = [];
  const s = new Session({ fileName: 'f.h5', post: m => out.push(m), createWorker: fake, timeoutMs: 50 });
  await s.handle({ type: 'ready' });
  await s.handle({ type: 'info', reqId: 1, path: '/hang' });
  assert.equal(out[1].ok, false); assert.match(out[1].error, /took longer than/);
  assert.equal(terminated, 1);
  await s.handle({ type: 'info', reqId: 2, path: '/ok' });
  assert.deepEqual(out[2], { type: 'result', reqId: 2, ok: true, data: { echo: '/ok' } });
  assert.equal(spawned, 2);
  s.dispose();
});
