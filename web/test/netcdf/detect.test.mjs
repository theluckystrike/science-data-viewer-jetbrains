import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat } from '../../src/netcdf/core/detect.mjs';
import { sniff } from '../../src/netcdf/core/open.mjs';
import { S } from './helpers.mjs';

const b = (...x) => Uint8Array.from(x);
test('signatures', () => {
  assert.equal(detectFormat(b(0x43, 0x44, 0x46, 1)).label, 'NetCDF-3 classic');
  assert.equal(detectFormat(b(0x43, 0x44, 0x46, 2)).label, 'NetCDF-3 64-bit offset');
  assert.equal(detectFormat(b(0x43, 0x44, 0x46, 5)).format, 'unsupported');
  assert.equal(detectFormat(b(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a)).format, 'hdf5');
  assert.equal(detectFormat(b(0x0e, 0x03, 0x13, 0x01)).label, 'HDF4');
  assert.equal(detectFormat(b(0xcd, 0xf3, 0, 1)).label, 'NASA CDF');
  assert.equal(detectFormat(b(1, 2, 3)).format, 'unknown');
  const ub = off => (off === 1024 ? b(0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a) : b(0, 0, 0, 0, 0, 0, 0, 0));
  assert.equal(detectFormat(b(0, 0, 0, 0, 0, 0, 0, 0), ub).label, 'HDF5 (user block)');
});

test('sniff real files', () => {
  assert.equal(sniff(S('era5-t2m-sample.nc')).format, 'hdf5');
  assert.equal(sniff(S('argo-profiles-classic.nc')).format, 'netcdf3');
  assert.equal(sniff(S('expected.json')).format, 'unknown');
});

test('truncated HDF5 files are reported as truncated, whole files are not', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const { hdf5EofAddress } = await import('../../src/netcdf/core/detect.mjs');
  const full = fs.readFileSync(S('era5-t2m-sample.nc'));
  assert.equal(hdf5EofAddress(full.subarray(0, 64)), full.length);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verj-trunc-'));
  try {
    const cut = path.join(dir, 'cut.nc');
    fs.writeFileSync(cut, full.subarray(0, Math.floor(full.length / 2)));
    const s = sniff(cut);
    assert.equal(s.format, 'unsupported');
    assert.match(s.reason, /truncated/);
    assert.equal(sniff(S('era5-t2m-sample.nc')).format, 'hdf5');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
