// Pure helpers for the webview. No DOM access here, so node tests can import them.

export function fmtNum(v) {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(fmtNum).join(', ') + ']';
  if (typeof v !== 'number') return String(v);
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a !== 0 && (a < 1e-4 || a >= 1e7)) return v.toExponential(4);
  return String(Number(v.toPrecision(7)));
}

export function fmtBytes(n) {
  if (!Number.isFinite(n)) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 2 : 1) : String(n)) + ' ' + u[i];
}

export function shapeText(shape, dims) {
  if (!shape || !shape.length) return 'scalar';
  return shape.map((n, i) => (dims && dims[i] && !/^dim_\d+$/.test(dims[i]) ? `${dims[i]}=${n}` : String(n))).join(' × ');
}

const pyStr = s => JSON.stringify(String(s));
const isIdent = s => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s);

/** Python snippet that loads the same slice the user is looking at. */
export function pythonSnippet({ fileName, path, lib, shape, dims, hs }) {
  const idx = (shape || []).map((n, d) => {
    if (!hs) return ':';
    const s = hs.start[d], c = hs.count[d], st = hs.step[d];
    if (c === 1 && n > 1 && hs.single && hs.single[d]) return String(s);
    const end = s + (c - 1) * st + 1;
    if (s === 0 && end >= n && st === 1) return ':';
    return `${s}:${end}${st > 1 ? ':' + st : ''}`;
  });
  if (lib === 'h5py') {
    const sel = shape && shape.length ? `[${idx.join(', ')}]` : '[()]';
    return `import h5py\n\nwith h5py.File(${pyStr(fileName)}, "r") as f:\n    data = f[${pyStr(path)}]${sel}\n    print(data.shape, data.dtype)`;
  }
  const slash = path.lastIndexOf('/');
  const group = slash > 0 ? path.slice(0, slash) : '';
  const name = path.slice(slash + 1);
  const isel = (shape || []).map((n, d) => {
    const k = dims && dims[d] ? dims[d] : `dim_${d}`;
    const key = isIdent(k) ? k : null;
    const v = idx[d];
    if (v === ':' || !key) return null;
    return `${key}=${/:/.test(v) ? `slice(${v.split(':').map(x => x || 'None').join(', ')})` : v}`;
  }).filter(Boolean);
  const open = group ? `xr.open_dataset(${pyStr(fileName)}, group=${pyStr(group)})` : `xr.open_dataset(${pyStr(fileName)})`;
  return `import xarray as xr\n\nds = ${open}\nda = ds[${pyStr(name)}]${isel.length ? `.isel(${isel.join(', ')})` : ''}\nprint(da)`;
}

// Colour maps: small anchor tables (matplotlib / Google Turbo / ColorBrewer, sampled at even steps), interpolated linearly.
// Viridis keeps its original 9 stops so the default picture does not change.
const VIRIDIS = [[68, 1, 84], [71, 44, 122], [59, 81, 139], [44, 113, 142], [33, 144, 141], [39, 173, 129], [92, 200, 99], [170, 220, 50], [253, 231, 37]];
const ANCHORS = {
  viridis: VIRIDIS,
  cividis: [[0, 32, 77], [26, 54, 108], [72, 76, 107], [102, 102, 112], [125, 124, 120], [152, 147, 117], [183, 172, 108], [217, 199, 89], [255, 233, 69]],
  magma: [[0, 0, 4], [28, 16, 68], [79, 18, 123], [129, 37, 129], [181, 54, 122], [229, 80, 100], [251, 135, 97], [254, 194, 135], [252, 253, 191]],
  inferno: [[0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50], [252, 255, 164]],
  plasma: [[13, 8, 135], [75, 3, 161], [125, 3, 168], [168, 34, 150], [203, 70, 121], [229, 107, 93], [248, 148, 65], [253, 195, 40], [240, 249, 33]],
  turbo: [[48, 18, 59], [65, 69, 171], [70, 117, 237], [57, 162, 252], [27, 207, 212], [36, 236, 166], [97, 252, 108], [164, 252, 59], [209, 232, 52], [243, 198, 58], [254, 155, 45], [243, 99, 21], [217, 56, 6], [177, 26, 1], [122, 4, 3]],
  gray: [[0, 0, 0], [255, 255, 255]],
  // Diverging: ColorBrewer RdBu reversed (blue for low, white in the middle, red for high).
  coolwarm: [[5, 48, 97], [33, 102, 172], [67, 147, 195], [146, 197, 222], [209, 229, 240], [247, 247, 247], [253, 219, 199], [244, 165, 130], [214, 96, 77], [178, 24, 43], [103, 0, 31]],
};
export const COLORMAPS = [
  ['viridis', 'Viridis'], ['cividis', 'Cividis'], ['magma', 'Magma'], ['inferno', 'Inferno'], ['plasma', 'Plasma'],
  ['turbo', 'Turbo'], ['gray', 'Gray'], ['coolwarm', 'Diverging (RdBu reversed)'],
];
export const isColormap = name => Object.prototype.hasOwnProperty.call(ANCHORS, name);

function interp(stops, t) {
  if (!(t >= 0)) t = 0; if (t > 1) t = 1;
  const x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)];
}

/** colormap('magma')(t) -> [r, g, b] for t in 0..1. Unknown names give viridis. reverse flips the map. */
export function colormap(name, reverse = false) {
  const stops = ANCHORS[isColormap(name) ? name : 'viridis'];
  return reverse ? t => interp(stops, 1 - (t >= 0 ? Math.min(1, t) : 0)) : t => interp(stops, t);
}
export function viridis(t) { return interp(VIRIDIS, t); }

/** Finite numbers of a flat array; sampled evenly when there are more than max of them. */
export function finiteSample(values, max = 1e6) {
  const v = [];
  const stepN = Math.max(1, Math.ceil(values.length / max));
  for (let i = 0; i < values.length; i += stepN) { const x = values[i]; if (typeof x === 'number' && Number.isFinite(x)) v.push(x); }
  return v;
}

/** Robust color range: 2nd and 98th percentile of finite values (sampled above 1e6 values). */
export function percentileRange(values, pLo = 0.02, pHi = 0.98) {
  const v = finiteSample(values);
  if (!v.length) return null;
  v.sort((a, b) => a - b);
  const lo = v[Math.floor(v.length * pLo)], hi = v[Math.min(v.length - 1, Math.floor(v.length * pHi))];
  return lo === hi ? { lo: v[0], hi: v[v.length - 1] === v[0] ? v[0] + 1 : v[v.length - 1] } : { lo, hi };
}
export const colorRange = values => percentileRange(values);

/** Smallest and largest finite value. */
export function minMaxRange(values) {
  let lo = Infinity, hi = -Infinity;
  for (const x of values) if (typeof x === 'number' && Number.isFinite(x)) { if (x < lo) lo = x; if (x > hi) hi = x; }
  if (lo === Infinity) return null;
  return lo === hi ? { lo, hi: lo + 1 } : { lo, hi };
}

/** -max|v| .. +max|v|, for anomalies with a diverging map. */
export function symmetricRange(values) {
  let m = 0, any = false;
  for (const x of values) if (typeof x === 'number' && Number.isFinite(x)) { any = true; const a = Math.abs(x); if (a > m) m = a; }
  if (!any) return null;
  if (m === 0) m = 1;
  return { lo: -m, hi: m };
}

/** Custom range from two inputs. Returns { ok, lo, hi } or { ok: false, error }. */
export function customRange(min, max) {
  const lo = typeof min === 'string' ? (min.trim() === '' ? NaN : Number(min)) : min;
  const hi = typeof max === 'string' ? (max.trim() === '' ? NaN : Number(max)) : max;
  if (typeof lo !== 'number' || typeof hi !== 'number' || !Number.isFinite(lo) || !Number.isFinite(hi)) return { ok: false, error: 'Enter two numbers for min and max.' };
  if (!(lo < hi)) return { ok: false, error: 'Min must be smaller than max.' };
  return { ok: true, lo, hi };
}

const attrNum = v => {
  const x = Array.isArray(v) ? v[0] : v;
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() !== '' ? Number(x) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
/**
 * Colour range from CF attributes: actual_range, else valid_range, else valid_min + valid_max.
 * attrs is the info.attrs list ([{ name, value }]). valid_* are in stored units when the variable is packed,
 * so scale_factor/add_offset are applied when decoded is true; actual_range is already in data units.
 */
export function attrRange(attrs, { decoded = false } = {}) {
  const m = {};
  for (const a of attrs || []) if (a && typeof a.name === 'string') m[a.name] = a.value;
  const pair = v => (Array.isArray(v) && v.length === 2 ? [attrNum(v[0]), attrNum(v[1])] : [undefined, undefined]);
  let lo, hi, source, packed = false;
  [lo, hi] = pair(m.actual_range); source = 'actual_range';
  if (lo === undefined || hi === undefined) { [lo, hi] = pair(m.valid_range); source = 'valid_range'; packed = true; }
  if (lo === undefined || hi === undefined) { lo = attrNum(m.valid_min); hi = attrNum(m.valid_max); source = 'valid_min/valid_max'; packed = true; }
  if (lo === undefined || hi === undefined) return null;
  if (packed && decoded) {
    const sc = attrNum(m.scale_factor), off = attrNum(m.add_offset);
    if (sc !== undefined) { lo *= sc; hi *= sc; }
    if (off !== undefined) { lo += off; hi += off; }
    if (lo > hi) [lo, hi] = [hi, lo];
  }
  if (!(lo < hi)) return null;
  return { lo, hi, source };
}

/** Value -> 0..1 on a linear or log scale, or null (no-data grey) for non-finite values and values <= 0 on a log scale. */
export function makeScale(lo, hi, log = false) {
  if (log) {
    if (!(lo > 0 && hi > lo)) return () => null;
    const a = Math.log10(lo), b = Math.log10(hi);
    return v => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? (Math.log10(v) - a) / (b - a) : null);
  }
  return v => (typeof v === 'number' && Number.isFinite(v) ? (v - lo) / (hi - lo) : null);
}

/**
 * Range for one heatmap. mode: 'minmax' | 'p2_98' | 'symmetric' | 'custom' | 'attrs'.
 * Returns { lo, hi, log, error? }: on a bad custom or log setting it falls back to 2-98 percentile / linear and says why.
 */
export function resolveRange(values, { mode = 'p2_98', custom, attrs, decoded, log = false } = {}) {
  let r = null, error;
  if (mode === 'minmax') r = minMaxRange(values);
  else if (mode === 'symmetric') r = symmetricRange(values);
  else if (mode === 'custom') {
    const c = customRange(custom && custom.min, custom && custom.max);
    if (c.ok) r = { lo: c.lo, hi: c.hi }; else error = c.error;
  } else if (mode === 'attrs') {
    r = attrRange(attrs, { decoded });
    if (!r) error = 'This variable has no actual_range, valid_range or valid_min/valid_max.';
  }
  if (!r) { const p = percentileRange(values); r = p && { lo: p.lo, hi: p.hi }; }
  if (!r) return null;
  const logOk = r.lo > 0;
  if (log && !logOk) error = error || 'Log scale needs a range above 0.';
  return { lo: r.lo, hi: r.hi, log: !!log && logOk, logOk, error };
}

/** Labels for a colour bar: nice ticks inside lo..hi (decades on a log scale), always with both ends. */
export function colorbarTicks(lo, hi, log = false, n = 5) {
  let t;
  if (log && lo > 0) {
    t = [];
    for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)) && t.length < 12; e++) t.push(Number((10 ** e).toPrecision(12)));
  } else t = ticks(lo, hi, n);
  const out = t.filter(x => x > lo && x < hi);
  return [lo, ...out, hi];
}

/** Nice axis ticks between lo and hi. */
export function ticks(lo, hi, n = 5) {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [lo];
  const span = hi - lo, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 5, 10].map(m => m * mag).find(s => span / s <= n) || mag * 10;
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + step * 1e-9; t += step) out.push(Number(t.toPrecision(12)));
  return out;
}

/** Reads the webview → host message for a view; mirrors protocol.mjs fields. */
export function readMessage(reqId, path, view, decode, purpose) {
  return { type: 'read', reqId, path, view, decode: !!decode, purpose };
}
