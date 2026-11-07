// Series at a point: values along one dimension at a clicked heatmap cell, with the other indices fixed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { openFile } from '../../src/netcdf/core/open.mjs';
import { readSeries, seriesStep, seriesTitle, MAX_SERIES_POINTS } from '../../src/netcdf/core/series.mjs';
import { seriesCsv } from '../../src/netcdf/core/export.mjs';
import { validateRequest } from '../../src/netcdf/core/protocol.mjs';
import { Session } from '../../src/netcdf/core/session.mjs';
import { fmtNum } from '../../src/netcdf/webview/util.js';
import { S, libs } from './helpers.mjs';

test('readSeries on the ERA5 sample: t2m along time at a fixed lat/lon equals the 2D slices at those indices', async () => {
  const o = await openFile(S('era5-t2m-sample.nc'), libs);
  try {
    const b = o.backend;
    const [nt, , ] = b.info('/t2m').shape;
    const lat = 10, lon = 20;
    const s = readSeries(b, '/t2m', 0, [5, lat, lon], true);
    assert.equal(s.values.length, nt);
    assert.deepEqual([s.dim, s.axis, s.step, s.count, s.len, s.units, s.name], ['time', 0, 1, nt, nt, 'K', 't2m']);
    for (let t = 0; t < nt; t++) {
      const slice = b.read('/t2m', { rowAxis: 1, colAxis: 2, index: [t, 0, 0], rowStart: 0, rowCount: 73, colStart: 0, colCount: 144 }, true);
      assert.equal(s.values[t], slice.values[lat][lon], 'time ' + t);
    }
    // The first 3 time steps, as the heatmap at time 0, 1, 2 shows them.
    assert.equal(s.values.slice(0, 3).length, 3);
    const times = b.read('/time', { rowAxis: 0, colAxis: -1, index: [], rowCount: nt }, true).times.map(x => x[0]);
    assert.deepEqual(s.coord.times, times);
    assert.equal(s.coord.times[0], '2024-12-01');
    const latV = b.read('/latitude', { rowAxis: 0, colAxis: -1, index: [], rowCount: 73 }, true).values[lat][0];
    const lonV = b.read('/longitude', { rowAxis: 0, colAxis: -1, index: [], rowCount: 144 }, true).values[lon][0];
    assert.deepEqual(s.fixed, [{ dim: 'latitude', index: lat, value: latV }, { dim: 'longitude', index: lon, value: lonV }]);
    assert.equal(seriesTitle(s, fmtNum), `t2m at latitude ${fmtNum(latV)}, longitude ${fmtNum(lonV)} over time`);

    // Along longitude instead (row = time, col = latitude on screen): the slider index of time is used.
    const sl = readSeries(b, '/t2m', 2, [3, lat, 0], true);
    const row = b.read('/t2m', { rowAxis: 1, colAxis: 2, index: [3, 0, 0], rowStart: lat, rowCount: 1, colStart: 0, colCount: 144 }, true).values[0];
    assert.deepEqual(sl.values, row);
    assert.equal(sl.fixed[0].value, times[3]); // a time coordinate is shown decoded

    // Raw (not decoded) values are the packed integers.
    const raw = readSeries(b, '/t2m', 0, [0, lat, lon], false);
    assert.ok(raw.values.every(v => Number.isInteger(v)));
    assert.equal(raw.decoded, false);

    // Indices out of range are clamped, like the sliders.
    assert.deepEqual(readSeries(b, '/t2m', 0, [0, 999, 999], true).fixed.map(f => f.index), [72, 143]);
    assert.throws(() => readSeries(b, '/t2m', 3, [0, 0, 0]), /3 dimensions/);
    assert.throws(() => readSeries(b, '/', 0, []), /Pick a variable/);
  } finally { o.backend.close(); }
});

test('series stride: at most 100,000 points and never more than maxReadValues', async () => {
  assert.equal(MAX_SERIES_POINTS, 100_000);
  assert.equal(seriesStep(100_000, MAX_SERIES_POINTS), 1);
  assert.equal(seriesStep(250_000, MAX_SERIES_POINTS), 3);
  const o = await openFile(S('era5-t2m-sample.nc'), libs);
  try {
    const nt = o.backend.info('/t2m').shape[0];
    const s = readSeries(o.backend, '/t2m', 0, [0, 1, 1], true, { maxReadValues: 10 });
    assert.equal(s.step, Math.ceil(nt / 10));
    assert.equal(s.values.length, Math.ceil(nt / s.step));
    assert.deepEqual(s.indices.slice(0, 3), [0, s.step, 2 * s.step]);
    assert.equal(s.coord.times.length, s.values.length);
    const full = readSeries(o.backend, '/t2m', 0, [0, 1, 1], true);
    assert.equal(s.values[1], full.values[s.step]);
    assert.equal(s.coord.times[1], full.coord.times[s.step]);
  } finally { o.backend.close(); }
});

test('series on a NetCDF-3 file', async () => {
  const o = await openFile(S('argo-profiles-classic.nc'), libs);
  try {
    const info = o.backend.info('/temp');
    const s = readSeries(o.backend, '/temp', 0, [0, 4], true);
    assert.equal(s.values.length, info.shape[0]);
    const col = o.backend.read('/temp', { rowAxis: 0, colAxis: 1, index: [], rowCount: info.shape[0], colCount: info.shape[1] }, true).values.map(r => r[4]);
    assert.deepEqual(s.values, col);
  } finally { o.backend.close(); }
});

test('protocol: series requests are checked', () => {
  assert.deepEqual(validateRequest({ type: 'series', reqId: 2, path: '/t2m', axis: 0, index: [1, 10, 20] }),
    { ok: true, req: { type: 'series', reqId: 2, path: '/t2m', axis: 0, index: [1, 10, 20], decode: true } });
  assert.equal(validateRequest({ type: 'series', reqId: 2, path: '/t2m', axis: 0, index: [], decode: false }).req.decode, false);
  for (const m of [
    { type: 'series', path: '/t2m', axis: 0, index: [] },
    { type: 'series', reqId: 1, path: 't2m', axis: 0, index: [] },
    { type: 'series', reqId: 1, path: '/t2m', index: [] },
    { type: 'series', reqId: 1, path: '/t2m', axis: -1, index: [] },
    { type: 'series', reqId: 1, path: '/t2m', axis: 1.5, index: [] },
    { type: 'series', reqId: 1, path: '/t2m', axis: 32, index: [] },
    { type: 'series', reqId: 1, path: '/t2m', axis: 0, index: [-1] },
    { type: 'series', reqId: 1, path: '/t2m', axis: 0, index: ['3'] },
    { type: 'series', reqId: 1, path: '/t2m', axis: 0, index: new Array(40).fill(0) },
  ]) assert.equal(validateRequest(m).ok, false, JSON.stringify(m));
});

test('Session series over the real worker, and errors come back as results', async () => {
  const out = [];
  const s = new Session({ fileName: 'era5-t2m-sample.nc', post: m => out.push(m), createWorker: () => new Worker(new URL('../../src/netcdf/worker.mjs', import.meta.url), { workerData: { filePath: S('era5-t2m-sample.nc'), opts: { maxReadValues: 1_000_000 } } }) });
  try {
    await s.handle({ type: 'ready' });
    await s.handle({ type: 'series', reqId: 1, path: '/t2m', axis: 0, index: [0, 10, 20] });
    assert.equal(out[1].ok, true, out[1].error);
    await s.handle({ type: 'read', reqId: 2, path: '/t2m', view: { rowAxis: 1, colAxis: 2, index: [2, 0, 0], rowStart: 10, rowCount: 1, colStart: 20, colCount: 1 } });
    assert.equal(out[1].data.values[2], out[2].data.values[0][0]);
    JSON.parse(JSON.stringify(out[1]));
    await s.handle({ type: 'series', reqId: 3, path: '/t2m', axis: 7, index: [] });
    assert.equal(out[3].ok, false);
    assert.match(out[3].error, /3 dimensions/);
    await s.handle({ type: 'series', reqId: 4, path: '/t2m', index: [] });
    assert.deepEqual([out[4].reqId, out[4].ok], [4, false]);
  } finally { s.dispose(); }
});

test('Copy as CSV of a series: coordinate and value, formula guard on text from the file', () => {
  const s = { name: 't2m', units: 'K', dim: 'time', values: [271.5, null, -3.25], times: null, indices: [0, 1, 2], coord: { values: [0, 6, 12], times: ['2024-12-01', '2024-12-01 06:00', '2024-12-01 12:00'] } };
  assert.equal(seriesCsv(s), 'time,t2m (K)\n2024-12-01,271.5\n2024-12-01 06:00,\n2024-12-01 12:00,-3.25\n');
  const noCoord = { name: 'v', units: null, dim: 'x', values: [1, 2], times: null, indices: [0, 5], coord: null };
  assert.equal(seriesCsv(noCoord), 'x,v\n0,1\n5,2\n');
  const evil = { name: '=cmd', units: '@u', dim: '+d', values: ['=1+1', 'NaN', 'ok'], times: null, indices: [0, 1, 2], coord: { values: ['-x', '@y', 'z,w'], times: null } };
  assert.equal(seriesCsv(evil), "'+d,'=cmd (@u)\n'-x,'=1+1\n'@y,NaN\n\"z,w\",ok\n");
  const numCoord = { name: 'v', units: '', dim: 'depth', values: [1], times: null, indices: [0], coord: { values: [-5.5], times: null } };
  assert.equal(seriesCsv(numCoord), 'depth,v\n-5.5,1\n');
});
