// NetCDF-3 (classic and 64-bit offset) backend. netcdfjs parses the header from the first bytes of the
// file; values are then read by byte offset, one run at a time, so the file is never loaded whole.
import fs from 'node:fs';
import { viewToHyperslab, toRows, product } from './slice.mjs';
import { attrValue, jsonSafe } from './values.mjs';
import { packing, decodeValue, parseTimeUnits, decodeTime, cfSummary } from './cf.mjs';
import { stats } from './stats.mjs';

const TYPES = {
  byte: { size: 1, dtype: 'int8', get: (dv, o) => dv.getInt8(o) },
  char: { size: 1, dtype: 'char', get: (dv, o) => dv.getUint8(o) },
  short: { size: 2, dtype: 'int16', get: (dv, o) => dv.getInt16(o, false) },
  int: { size: 4, dtype: 'int32', get: (dv, o) => dv.getInt32(o, false) },
  float: { size: 4, dtype: 'float32', get: (dv, o) => dv.getFloat32(o, false) },
  double: { size: 8, dtype: 'float64', get: (dv, o) => dv.getFloat64(o, false) },
};
const MAX_HEADER = 64 * 1024 * 1024;

export function readHeader(NetCDFReader, fd, fileSize) {
  let len = Math.min(fileSize, 64 * 1024), lastErr;
  for (;;) {
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, 0);
    try { return new NetCDFReader(buf); } catch (e) { lastErr = e; }
    if (len >= fileSize) break;
    if (len >= MAX_HEADER) throw new Error('The NetCDF header is larger than 64 MB. It is not supported.');
    len = Math.min(fileSize, len * 4);
  }
  throw new Error('Not a valid NetCDF-3 file: ' + (lastErr && lastErr.message));
}

function attrMap(attrs) { const m = {}; for (const a of attrs || []) m[a.name] = a.value; return m; }
function attrList(attrs) { return (attrs || []).map(a => ({ name: a.name, value: attrValue(a.value), dtype: a.type, internal: false })); }

export function openNetcdf3(NetCDFReader, filePath, opts = {}) {
  const fd = fs.openSync(filePath, 'r');
  const size = fs.fstatSync(fd).size;
  let r;
  try { r = readHeader(NetCDFReader, fd, size); } catch (e) { fs.closeSync(fd); throw e; }
  const dims = r.dimensions;
  const recId = r.recordDimension ? r.recordDimension.id : -1;
  const numRecs = r.recordDimension ? r.recordDimension.length : 0;
  const recStep = r.recordDimension ? r.recordDimension.recordStep : 0;
  const label = r.version === 2 || /64/.test(String(r.version)) ? 'NetCDF-3 64-bit offset' : 'NetCDF-3 classic';

  const vars = new Map();
  for (const v of r.variables) {
    const t = TYPES[v.type];
    const fullShape = v.dimensions.map(id => (id === recId ? numRecs : dims[id].size));
    const dimNames = v.dimensions.map(id => dims[id].name);
    const isChar = v.type === 'char' && fullShape.length > 0;
    const shape = isChar ? fullShape.slice(0, -1) : fullShape;
    vars.set('/' + v.name, { v, t, fullShape, shape, dimNames: isChar ? dimNames.slice(0, -1) : dimNames, isChar, strLen: isChar ? fullShape[fullShape.length - 1] : 1, attrs: attrMap(v.attributes) });
  }
  const coordOf = name => (vars.has('/' + name) && vars.get('/' + name).shape.length === 1 && vars.get('/' + name).dimNames[0] === name ? '/' + name : null);

  function getVar(path) { const x = vars.get(path); if (!x) throw new Error('Not found: ' + path); return x; }

  function list(path) {
    if (path !== '/') throw new Error('NetCDF-3 files have no groups');
    const items = [...vars.entries()].map(([p, x]) => ({
      name: x.v.name, path: p, kind: 'dataset', shape: x.shape, dims: x.dimNames,
      dtype: x.isChar ? `string(${x.strLen})` : x.t.dtype, longName: typeof x.attrs.long_name === 'string' ? x.attrs.long_name : undefined,
      units: typeof x.attrs.units === 'string' ? x.attrs.units : undefined, isCoord: !!coordOf(x.v.name) && coordOf(x.v.name) === p,
    }));
    return { path, items, more: 0 };
  }

  function info(path) {
    if (path === '/') {
      return { path, name: '/', kind: 'group', format: label, children: vars.size, attrs: attrList(r.globalAttributes),
        dimensions: dims.map((d, i) => ({ name: d.name, size: i === recId ? numRecs : d.size, unlimited: i === recId })) };
    }
    const x = getVar(path);
    return {
      path, name: x.v.name, kind: 'dataset', shape: x.shape, dims: x.dimNames, dtype: x.isChar ? `string(${x.strLen})` : x.t.dtype,
      numeric: !x.isChar, compound: null, chunks: null, filters: [], itemSize: x.t.size * x.strLen, bytes: product(x.fullShape) * x.t.size,
      record: x.v.record, offset: Number(x.v.offset), attrs: attrList(x.v.attributes), cf: cfSummary(x.attrs),
      coords: x.dimNames.map(n => { const c = coordOf(n); return c && c !== path ? c : null; }), dimensionOnly: false,
    };
  }

  function byteOffset(x, idx) {
    // idx covers the full shape (including the char length dim for strings).
    const s = x.fullShape;
    let flat = 0, first = 0;
    if (x.v.record) { first = 1; }
    for (let d = first; d < s.length; d++) flat = flat * s[d] + idx[d];
    return Number(x.v.offset) + (x.v.record ? idx[0] * recStep : 0) + flat * x.t.size;
  }

  function read(path, view, decode = true) {
    const x = getVar(path);
    const hs = viewToHyperslab(x.shape, view);
    const n = product(hs.count);
    if (opts.maxReadValues && n > opts.maxReadValues) throw new Error(`Slice has ${n} values; the limit is ${opts.maxReadValues}.`);
    const flat = [];
    const nd = x.shape.length;
    if (n > 0 || nd === 0) {
      // Iterate over all dims but the last shown dim; read one run along the last dim at a time.
      const last = nd - 1;
      const outer = nd === 0 ? { start: [], count: [], step: [] } : { start: hs.start.slice(0, last), count: hs.count.slice(0, last), step: hs.step.slice(0, last) };
      const runCount = nd === 0 ? 1 : hs.count[last], runStep = nd === 0 ? 1 : hs.step[last];
      const elemBytes = x.t.size * x.strLen;
      // Byte distance between two neighbours along the last shown dim: a whole record for the record dim.
      const stride = nd > 0 && x.v.record && last === 0 ? recStep : elemBytes;
      const spanBytes = ((runCount - 1) * runStep) * stride + elemBytes;
      const oneRead = spanBytes <= 4 * 1024 * 1024;
      const buf = Buffer.alloc(oneRead ? spanBytes : elemBytes);
      const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      const decodeAt = (o, got) => {
        if (o + elemBytes > got) return null;
        if (x.isChar) {
          let s = '';
          for (let c = 0; c < x.strLen; c++) { const b = buf[o + c]; if (b === 0) break; s += String.fromCharCode(b); }
          return s;
        }
        return x.t.get(dv, o);
      };
      const visit = idxOuter => {
        const idx = nd === 0 ? [] : [...idxOuter, hs.start[last]];
        if (x.isChar) idx.push(0);
        const off = byteOffset(x, idx);
        if (oneRead) {
          const got = fs.readSync(fd, buf, 0, spanBytes, off);
          for (let k = 0; k < runCount; k++) flat.push(decodeAt(k * runStep * stride, got));
        } else {
          for (let k = 0; k < runCount; k++) flat.push(decodeAt(0, fs.readSync(fd, buf, 0, elemBytes, off + k * runStep * stride)));
        }
      };
      if (outer.start.length === 0) visit([]);
      else {
        const k = new Array(outer.start.length).fill(0);
        const idx = outer.start.slice();
        for (;;) {
          visit(idx);
          let d = idx.length - 1;
          while (d >= 0) { k[d]++; if (k[d] < outer.count[d]) { idx[d] = outer.start[d] + k[d] * outer.step[d]; break; } k[d] = 0; idx[d] = outer.start[d]; d--; }
          if (d < 0) break;
        }
      }
    }
    const p = decode && !x.isChar ? packing(x.attrs) : null;
    const tu = decode && !x.isChar ? parseTimeUnits(x.attrs.units) : null;
    const vals = p ? flat.map(v => decodeValue(v, p)) : flat;
    const st = x.isChar ? null : stats(vals);
    const times = tu ? toRows(vals.map(v => decodeTime(v, tu, x.attrs.calendar)), hs) : null;
    return { path, start: hs.start, count: hs.count, step: hs.step, rows: hs.rows, cols: hs.cols, values: toRows(vals.map(jsonSafe), hs), times, stats: st, decoded: !!p, compound: null };
  }

  return { format: 'netcdf3', label, list, info, read, close() { try { fs.closeSync(fd); } catch { /* closed */ } } };
}
