import { NetCDFReader } from 'netcdfjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export const S = p => fileURLToPath(new URL('../../samples-netcdf/' + p, import.meta.url));
export const expected = JSON.parse(fs.readFileSync(S('expected.json'), 'utf8'));
export const libs = { NetCDFReader, h5wasm: async () => { const m = (await import('h5wasm/node')).default; await m.ready; return m; } };
