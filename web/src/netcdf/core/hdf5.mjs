// HDF5 and NetCDF-4 backend on top of h5wasm (Node build: the HDF5 C library reads the file by offset,
// so only the bytes of the requested slice and the metadata are read).
import { viewToHyperslab, toH5Ranges, toRows, product } from './slice.mjs';
import { describeH5Type, describeFilters, attrValue, jsonSafe, isNumericH5 } from './values.mjs';
import { packing, decodeValue, parseTimeUnits, decodeTime, cfSummary } from './cf.mjs';
import { stats } from './stats.mjs';

const INTERNAL_ATTRS = new Set(['DIMENSION_LIST', 'REFERENCE_LIST', 'CLASS', 'NAME', '_Netcdf4Dimid', '_Netcdf4Coordinates', '_NCProperties', '_nc3_strict', '_SuperblockVersion', '_IsNetcdf4']);
const NC_DIM_ONLY = 'This is a netCDF dimension but not a netCDF variable';
const MAX_CHILDREN = 5000;

const join = (g, k) => (g === '/' ? '' : g) + '/' + k;
const base = p => p.slice(p.lastIndexOf('/') + 1);

function readAttrs(obj) {
  const out = {}, list = [];
  let names = [];
  try { names = Object.keys(obj.attrs); } catch { return { map: out, list }; }
  for (const name of names) {
    let value, dtype = '';
    try {
      const a = obj.attrs[name];
      dtype = describeH5Type(a.metadata);
      value = a.metadata && a.metadata.type === 7 ? '<reference>' : a.value;
    } catch (e) { value = '<unreadable: ' + e.message + '>'; }
    if (!(Array.isArray(value) && value.length && typeof value[0] === 'object' && value[0] && !ArrayBuffer.isView(value[0]))) out[name] = value;
    list.push({ name, value: attrValue(Array.isArray(value) && value.some(x => x && typeof x === 'object' && !ArrayBuffer.isView(x) && !Array.isArray(x)) ? '<references>' : value), dtype, internal: INTERNAL_ATTRS.has(name) });
  }
  return { map: out, list };
}

function strAttr(map, k) {
  const v = map[k];
  if (typeof v === 'string') return v;
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0];
  return undefined;
}

export function openHdf5(h5wasm, filePath, opts = {}) {
  const file = new h5wasm.File(filePath, 'r');
  const rootAttrs = readAttrs(file);
  let isNc4 = '_NCProperties' in rootAttrs.map || /CF-|COARDS/i.test(strAttr(rootAttrs.map, 'Conventions') || '');
  const dimCache = new Map();

  function getObj(path) {
    const o = path === '/' ? file : file.get(path);
    if (!o) throw new Error('Not found: ' + path);
    return o;
  }

  function kindOf(o) {
    // instanceof, not constructor.name: names do not survive minification.
    if (!o) return 'missing';
    if (o instanceof h5wasm.Dataset) return 'dataset';
    if (o instanceof h5wasm.Group) return 'group';
    if (h5wasm.Datatype && o instanceof h5wasm.Datatype) return 'datatype';
    if (o.type === 'ExternalLink') return 'external';
    if (o.type === 'BrokenSoftLink') return 'broken';
    return 'other';
  }

  function dimNames(ds, path) {
    if (dimCache.has(path)) return dimCache.get(path);
    const shape = ds.shape || [];
    const names = [], coords = [];
    let labels = [];
    try { labels = ds.get_dimension_labels() || []; } catch { /* no labels */ }
    let selfScale = false;
    try { const a = readAttrs(ds).map; selfScale = strAttr(a, 'CLASS') === 'DIMENSION_SCALE' && shape.length === 1; } catch { /* plain dataset */ }
    if (selfScale) { isNc4 = true; const r = { names: [base(path)], coords: [path] }; dimCache.set(path, r); return r; }
    for (let i = 0; i < shape.length; i++) {
      let scales = [];
      try { scales = ds.get_attached_scales(i) || []; } catch { /* not attached */ }
      if (scales.length) { names.push(base(scales[0])); coords.push(scales[0]); isNc4 = true; } else { names.push(labels[i] || `dim_${i}`); coords.push(null); }
    }
    const r = { names, coords };
    dimCache.set(path, r);
    return r;
  }

  function entry(group, key) {
    const path = join(group, key);
    let o;
    try { o = file.get(path); } catch (e) { return { name: key, path, kind: 'error', error: e.message }; }
    const kind = kindOf(o);
    const e = { name: key, path, kind };
    if (kind === 'external') { e.target = `${o.filename}:${o.obj_path}`; return e; }
    if (kind === 'broken') { e.target = o.target; return e; }
    if (kind === 'group') { try { e.children = o.keys().length; } catch { e.children = 0; } return e; }
    if (kind === 'dataset') {
      try {
        e.shape = o.shape || [];
        e.dtype = describeH5Type(o.metadata);
        const a = readAttrs(o).map;
        const nm = strAttr(a, 'NAME');
        if (nm && nm.startsWith(NC_DIM_ONLY)) e.kind = 'dimension';
        if (strAttr(a, 'CLASS') === 'DIMENSION_SCALE') e.isCoord = true;
        e.longName = strAttr(a, 'long_name');
        e.units = strAttr(a, 'units');
        if (e.shape.length) e.dims = dimNames(o, path).names;
      } catch (err) { e.error = err.message; }
    }
    return e;
  }

  function list(path) {
    const g = getObj(path);
    if (kindOf(g) !== 'group') throw new Error('Not a group: ' + path);
    const keys = g.keys();
    const items = keys.slice(0, MAX_CHILDREN).map(k => entry(path, k));
    return { path, items, more: Math.max(0, keys.length - MAX_CHILDREN) };
  }

  function info(path) {
    const o = getObj(path);
    const kind = kindOf(o);
    const a = readAttrs(o);
    const out = { path, name: path === '/' ? '/' : base(path), kind, attrs: a.list };
    if (path === '/') { out.format = isNc4 ? 'NetCDF-4 (HDF5)' : 'HDF5'; }
    if (kind === 'group') { out.children = o.keys().length; return out; }
    if (kind !== 'dataset') return out;
    const m = o.metadata;
    out.shape = o.shape || [];
    out.dtype = describeH5Type(m);
    out.numeric = isNumericH5(m);
    out.compound = m.type === 6 ? m.compound_type.members.map(x => x.name) : null;
    out.chunks = m.chunks || null;
    out.maxshape = m.maxshape || null;
    out.itemSize = m.size;
    out.bytes = product(out.shape) * m.size;
    try { out.filters = describeFilters(o.filters); } catch { out.filters = []; }
    const dn = dimNames(o, path);
    out.dims = dn.names;
    out.coords = dn.coords.map(c => {
      if (!c || c === path) return null;
      try { const cd = file.get(c); const ca = readAttrs(cd).map; const nm = strAttr(ca, 'NAME'); return nm && nm.startsWith(NC_DIM_ONLY) ? null : c; } catch { return null; }
    });
    out.cf = cfSummary(a.map);
    const nm = strAttr(a.map, 'NAME');
    out.dimensionOnly = !!(nm && nm.startsWith(NC_DIM_ONLY));
    return out;
  }

  function read(path, view, decode = true) {
    const o = getObj(path);
    if (kindOf(o) !== 'dataset') throw new Error('Not a dataset: ' + path);
    const shape = o.shape || [];
    const m = o.metadata;
    const hs = viewToHyperslab(shape, view);
    const n = product(hs.count);
    if (opts.maxReadValues && n > opts.maxReadValues) throw new Error(`Slice has ${n} values; the limit is ${opts.maxReadValues}.`);
    let flat;
    try {
      flat = shape.length === 0 ? [o.value] : (n === 0 ? [] : o.slice(toH5Ranges(hs)));
    } catch (e) {
      const f = (() => { try { return describeFilters(o.filters).map(x => x.name).join(', '); } catch { return ''; } })();
      throw new Error('Cannot read this dataset' + (f ? ` (filters: ${f})` : '') + ': ' + (e.message || e));
    }
    if (!flat || typeof flat.length !== 'number') flat = [flat];
    const attrs = readAttrs(o).map;
    const p = decode && isNumericH5(m) ? packing(attrs) : null;
    const tu = decode ? parseTimeUnits(strAttr(attrs, 'units')) : null;
    const vals = new Array(flat.length);
    for (let i = 0; i < flat.length; i++) vals[i] = p ? decodeValue(typeof flat[i] === 'bigint' ? Number(flat[i]) : flat[i], p) : flat[i];
    const st = isNumericH5(m) ? stats(vals) : null;
    const times = tu && isNumericH5(m) ? toRows(vals.map(v => decodeTime(v, tu, strAttr(attrs, 'calendar'))), hs) : null;
    return { path, start: hs.start, count: hs.count, step: hs.step, rows: hs.rows, cols: hs.cols, values: toRows(vals.map(jsonSafe), hs), times, stats: st, decoded: !!p, compound: m.type === 6 ? m.compound_type.members.map(x => x.name) : null };
  }

  return {
    format: 'hdf5',
    get label() { return isNc4 ? 'NetCDF-4 (HDF5)' : 'HDF5'; },
    list, info, read,
    close() { try { file.close(); } catch { /* already closed */ } },
  };
}
