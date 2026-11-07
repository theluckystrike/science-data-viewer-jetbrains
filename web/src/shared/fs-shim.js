// Stand-in for node:fs inside the worker. The NetCDF core opens "/zovo/<token>" and reads it by offset;
// each read becomes one range request to the host. Nothing is loaded whole.
import { readRangeSync, metaSync } from './range-read.js';

const PREFIX = '/zovo/';
const tokenOf = p => { if (typeof p !== 'string' || !p.startsWith(PREFIX)) throw new Error('Unknown file: ' + p); return p.slice(PREFIX.length); };

export function openSync(path) { const token = tokenOf(path); return { token, size: metaSync(token).size }; }
export function fstatSync(fd) { return { size: fd.size }; }
export function statSync(path) { return { size: metaSync(tokenOf(path)).size }; }
export function closeSync() {}
export function readSync(fd, buf, off, len, pos) {
  const n = Math.max(0, Math.min(len, fd.size - pos));
  if (n === 0) return 0;
  buf.set(readRangeSync(fd.token, pos, n), off);
  return n;
}
export function readFileSync() { throw new Error('readFileSync is not available in the viewer'); }
export function existsSync() { return false; }
export const promises = {};
export default { openSync, fstatSync, statSync, closeSync, readSync, readFileSync, existsSync, promises };
