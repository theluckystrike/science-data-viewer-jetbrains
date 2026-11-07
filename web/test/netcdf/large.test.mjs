import test from 'node:test';
import assert from 'node:assert/strict';
import { openFile } from '../../src/netcdf/core/open.mjs';
import { S, libs } from './helpers.mjs';

test('a 37 GB logical dataset opens and pages fast (read by slice)', async () => {
  const t0 = Date.now();
  const { backend: b } = await openFile(S('huge-sparse.h5'), libs);
  try {
    const info = b.info('/big');
    assert.deepEqual(info.shape, [100000, 100000]);
    assert.equal(info.bytes, 4e10);
    const page = b.read('/big', { rowAxis: 0, colAxis: 1, rowStart: 999, rowCount: 2, colStart: 0, colCount: 3 });
    assert.deepEqual(page.values, [[999000, 999001, 999002], [-1, -1, -1]]);
    const plot = b.read('/big', { rowAxis: 0, colAxis: 1, rowCount: 100000, colCount: 100000, rowStep: 196, colStep: 196 });
    assert.equal(plot.rows, 511);
    assert.equal(plot.values[0][0], 0);
    const ms = Date.now() - t0;
    assert.ok(ms < 15000, `took ${ms} ms`);
    console.log(`# huge-sparse: open + page + 511x511 sampled plot in ${ms} ms`);
  } finally { b.close(); }
});
