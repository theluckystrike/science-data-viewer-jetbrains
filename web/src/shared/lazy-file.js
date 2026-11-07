// Puts the open file into the h5wasm (Emscripten) file system as a read-only node whose bytes come
// from range requests, 1 MB per chunk, with a small cache. The HDF5 C library then reads only the
// metadata and the chunks a slice needs, so a 2 GB file opens without loading it.
import { readRangeSync } from './range-read.js';

const CHUNK = 1 << 20;
const MAX_CHUNKS = 96; // about 96 MB of cache at most

export function mountRangeFile(FS, dir, name, token, size) {
  try { FS.mkdir(dir); } catch { /* exists */ }
  const cache = new Map();
  const chunk = i => {
    let c = cache.get(i);
    if (c) { cache.delete(i); cache.set(i, c); return c; }
    const start = i * CHUNK;
    c = readRangeSync(token, start, Math.min(CHUNK, size - start));
    cache.set(i, c);
    if (cache.size > MAX_CHUNKS) cache.delete(cache.keys().next().value);
    return c;
  };
  const contents = { length: size, get(idx) { if (idx < 0 || idx >= size) return undefined; return chunk((idx / CHUNK) | 0)[idx % CHUNK]; } };
  const node = FS.createFile(dir, name, { isDevice: false, contents }, true, false);
  node.contents = contents;
  Object.defineProperties(node, { usedBytes: { get() { return size; } } });
  const copy = (buffer, offset, length, position) => {
    if (position >= size) return 0;
    const n = Math.min(size - position, length);
    let done = 0;
    while (done < n) {
      const p = position + done, ci = (p / CHUNK) | 0, co = p % CHUNK;
      const c = chunk(ci);
      const take = Math.min(n - done, c.length - co);
      buffer.set(c.subarray(co, co + take), offset + done);
      done += take;
    }
    return n;
  };
  const ops = {};
  for (const [k, fn] of Object.entries(node.stream_ops)) ops[k] = (...a) => fn(...a);
  ops.read = (stream, buffer, offset, length, position) => copy(buffer, offset, length, position);
  ops.mmap = () => { throw new FS.ErrnoError(48); };
  node.stream_ops = ops;
  return dir + '/' + name;
}
