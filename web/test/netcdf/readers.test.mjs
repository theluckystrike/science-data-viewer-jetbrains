import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { openFile } from '../../src/netcdf/core/open.mjs';
import { S, expected as E, libs } from './helpers.mjs';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('NetCDF-4: dimension names, CF packing, fill, NaN, time decoding', async () => {
  const { backend: b } = await openFile(S('era5-t2m-sample.nc'), libs);
  try {
    assert.equal(b.label, 'NetCDF-4 (HDF5)');
    const items = b.list('/').items;
    const t2m = items.find(i => i.name === 't2m');
    assert.deepEqual(t2m.dims, ['time', 'latitude', 'longitude']);
    assert.equal(items.find(i => i.name === 'time').isCoord, true);
    const info = b.info('/t2m');
    assert.deepEqual(info.chunks, [1, 73, 144]);
    assert.deepEqual(info.filters.map(f => f.name), ['shuffle', 'deflate (gzip)']);
    assert.deepEqual(info.coords, ['/time', '/latitude', '/longitude']);
    assert.equal(info.cf.units, 'K');
    assert.ok(info.attrs.find(a => a.name === 'DIMENSION_LIST').internal);
    const r = b.read('/t2m', { rowAxis: 1, colAxis: 2, index: [5, 0, 0], rowStart: 10, rowCount: 1, colStart: 20, colCount: 1 });
    near(r.values[0][0], E.t2m_5_10_20, 1e-9);
    assert.equal(r.decoded, true);
    const raw = b.read('/t2m', { rowAxis: 1, colAxis: 2, rowCount: 1, colCount: 1 }, false);
    assert.equal(raw.values[0][0], E.t2m_raw_0_0_0);
    const dec = b.read('/t2m', { rowAxis: 1, colAxis: 2, rowCount: 1, colCount: 1 });
    assert.equal(dec.values[0][0], null);
    assert.equal(dec.stats.fill, 1);
    const tp = b.read('/tp', { rowAxis: 1, colAxis: 2, rowStart: 71, rowCount: 1, colStart: 3, colCount: 1 });
    assert.equal(tp.values[0][0], 'NaN');
    assert.equal(E.tp_0_71_3_isnan, true);
    const t = b.read('/time', { rowAxis: 0, colAxis: -1, rowCount: 2 });
    assert.equal(t.values[0][0], E.time_0);
    assert.deepEqual(t.times, [['2024-12-01'], ['2024-12-01 06:00']]);
    near(b.read('/latitude', { rowAxis: 0, colAxis: -1, rowStart: 10, rowCount: 1 }).values[0][0], E.lat_10);
    assert.equal(b.info('/').format, 'NetCDF-4 (HDF5)');
  } finally { b.close(); }
});

test('NetCDF-3: header from netcdfjs, record variables read by offset, strides, char variables', async () => {
  const { backend: b } = await openFile(S('argo-profiles-classic.nc'), libs);
  try {
    assert.match(b.label, /NetCDF-3/);
    const root = b.info('/');
    assert.deepEqual(root.dimensions.find(d => d.name === 'time'), { name: 'time', size: 12, unlimited: true });
    near(b.read('/temp', { rowAxis: 0, colAxis: 1, rowStart: 2, rowCount: 1, colStart: 7, colCount: 1 }).values[0][0], E.temp_2_7);
    const col = b.read('/temp', { rowAxis: 0, colAxis: 1, rowCount: 12, rowStep: 3, colStart: 7, colCount: 1 });
    assert.deepEqual(col.values.map(x => x[0]), E.temp_col7_step3);
    const tr = b.read('/temp', { rowAxis: 1, colAxis: 0, rowStart: 7, rowCount: 1, colCount: 12, colStep: 3 });
    assert.deepEqual(tr.values[0], E.temp_col7_step3);
    const fill = b.read('/temp', { rowAxis: 0, colAxis: 1, rowStart: 3, rowCount: 1, colStart: 30, colCount: 10 });
    assert.ok(fill.values[0].every(v => v === null));
    const raw = b.read('/salinity', { rowAxis: 0, colAxis: 1, rowStart: 4, rowCount: 1, colStart: 20, colCount: 1 }, false);
    assert.equal(raw.values[0][0], E.sal_raw_4_20);
    near(b.read('/salinity', { rowAxis: 0, colAxis: 1, rowStart: 4, rowCount: 1, colStart: 20, colCount: 1 }).values[0][0], 35 + E.sal_raw_4_20 * 0.001, 1e-6);
    const t = b.read('/time', { rowAxis: 0, colAxis: -1, rowCount: 100 });
    assert.deepEqual(t.values.map(x => x[0]), E.time_all);
    assert.equal(t.times[0][0], '2026-01-01');
    assert.equal(b.read('/station', { rowAxis: 0, colAxis: -1, rowStart: 5, rowCount: 1 }).values[0][0], E.station_5);
    assert.equal(b.info('/temp').coords[1], '/depth');
  } finally { b.close(); }
});

test('HDF5: groups, links, compound, strings, image slices, LZF', async () => {
  const { backend: b } = await openFile(S('beamline-scan.h5'), libs);
  try {
    assert.equal(b.label, 'HDF5');
    const data = b.list('/entry/data').items;
    assert.equal(data.find(i => i.name === 'calibration').kind, 'external');
    assert.equal(data.find(i => i.name === 'latest_image').kind, 'dataset');
    assert.equal(b.read('/entry/instrument/detector/image', { rowAxis: 0, colAxis: 1, rowStart: 100, rowCount: 1, colStart: 37, colCount: 1 }).values[0][0], E.image_100_37);
    const col = b.read('/entry/instrument/detector/image', { rowAxis: 0, colAxis: 1, rowStart: 10, rowCount: 5, colStart: 3, colCount: 1 });
    assert.deepEqual(col.values.map(x => x[0]), E.image_rows_10_15_cols_3);
    const sp = b.read('/entry/data/spectrum', { rowAxis: 0, colAxis: -1, rowCount: 10 });
    near(sp.values.reduce((s, x) => s + x[0], 0), E.spectrum_sum_first_10, 1e-6);
    const pos = b.read('/entry/scan/positions', { rowAxis: 0, colAxis: -1, rowCount: 2 });
    assert.deepEqual(pos.compound, ['step', 'motor_x_mm', 'motor_y_mm', 'ok']);
    assert.equal(pos.values[1][0][0], 1);
    assert.equal(b.read('/notes/labels', { rowAxis: 0, colAxis: -1, rowCount: 3 }).values[2][0], 'scan <b>&</b>');
    assert.equal(b.read('/entry/sample_name', {}).values[0][0], 'silicon wafer #7');
    near(b.read('/entry/scan/stack_lzf', { rowAxis: 1, colAxis: 2, index: [3, 0, 0], rowStart: 5, rowCount: 1, colStart: 7, colCount: 1 }).values[0][0], E.stack_lzf_3_5_7, 1e-6);
    assert.equal(b.info('/entry/scan/stack_lzf').filters[0].name, 'lzf');
    assert.throws(() => b.read('/entry', {}), /Not a dataset/);
    assert.throws(() => b.info('/nope'));
  } finally { b.close(); }
});

test('limits: read size and file size give clear messages; unknown files are refused', async () => {
  const { backend: b } = await openFile(S('era5-t2m-sample.nc'), libs, { maxReadValues: 100 });
  try { assert.throws(() => b.read('/t2m', { rowAxis: 1, colAxis: 2, rowCount: 73, colCount: 144 }), /10512 values; the limit is 100/); } finally { b.close(); }
  await assert.rejects(openFile(S('era5-t2m-sample.nc'), libs, { maxFileSizeMB: 0.5 }), /limit is 0.5 MB/);
  await assert.rejects(openFile(S('expected.json'), libs), /not HDF5 or NetCDF/);
});

test('truncated and garbage files fail with a message, not a crash', async () => {
  const dir = fs.mkdtempSync(S('tmp-'));
  try {
    const full = fs.readFileSync(S('argo-profiles-classic.nc'));
    fs.writeFileSync(dir + '/cut.nc', full.subarray(0, 300));
    await assert.rejects(openFile(dir + '/cut.nc', libs), /NetCDF/);
    const h5 = fs.readFileSync(S('beamline-scan.h5'));
    fs.writeFileSync(dir + '/cut.h5', h5.subarray(0, 2000));
    // The superblock fits in 2000 bytes, so the file may open; reading data past the cut must then throw.
    let b = null;
    try { b = (await openFile(dir + '/cut.h5', libs)).backend; } catch (e) { assert.match(String(e.message), /\w/); }
    if (b) {
      try { assert.throws(() => { b.list('/entry'); b.read('/entry/instrument/detector/image', { rowAxis: 0, colAxis: 1, rowCount: 5, colCount: 5 }); }); } finally { b.close(); }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
