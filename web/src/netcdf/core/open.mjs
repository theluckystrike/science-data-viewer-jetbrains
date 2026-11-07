// Opens a file with the right backend after checking its signature. Never runs code from the file.
import fs from 'node:fs';
import { detectFormat } from './detect.mjs';
import { openNetcdf3 } from './netcdf3.mjs';
import { openHdf5 } from './hdf5.mjs';

export function sniff(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const head = Buffer.alloc(Math.min(64, size)); // 8 bytes for the signatures, 20 for the MATLAB v5 text header, 64 for the HDF5 superblock
    fs.readSync(fd, head, 0, head.length, 0);
    const sigAt = off => { if (off + 8 > size) return null; const b = Buffer.alloc(8); fs.readSync(fd, b, 0, 8, off); return b; };
    return { size, ...detectFormat(head, sigAt, size) };
  } finally { fs.closeSync(fd); }
}

/** libs: { h5wasm: () => Promise<module>, NetCDFReader } so tests and the bundle inject the same code. */
export async function openFile(filePath, libs, opts = {}) {
  const s = sniff(filePath);
  if (opts.maxFileSizeMB && s.size > opts.maxFileSizeMB * 1024 * 1024) {
    throw Object.assign(new Error(`This file is ${(s.size / 1048576).toFixed(0)} MB. The limit is ${opts.maxFileSizeMB} MB (setting hdf5NetcdfExplorer.maxFileSizeMB).`), { code: 'TOO_BIG' });
  }
  if (s.format === 'netcdf3') return { sniff: s, backend: openNetcdf3(libs.NetCDFReader, filePath, opts) };
  if (s.format === 'hdf5') {
    const h5wasm = await libs.h5wasm();
    return { sniff: s, backend: openHdf5(h5wasm, filePath, opts) };
  }
  throw Object.assign(new Error(s.reason || 'Unsupported file'), { code: 'UNSUPPORTED' });
}
