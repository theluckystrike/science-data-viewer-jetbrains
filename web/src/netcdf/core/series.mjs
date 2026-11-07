// "Series at a point": the values of a variable along one dimension, with every other index fixed
// (the clicked heatmap cell and the slider positions). Runs in the worker on top of the normal 1D read.

export const MAX_SERIES_POINTS = 100_000;

/** Step so that a dimension of length len gives at most max points. */
export function seriesStep(len, max) { return len <= max ? 1 : Math.ceil(len / max); }

/**
 * backend: the open reader (info/read). Returns
 * { path, name, units, dim, axis, start, step, count, indices, values, times, coord: { path, values, times } | null, fixed: [{ dim, index, value }] }.
 */
export function readSeries(backend, path, axis, index, decode = true, opts = {}) {
  const info = backend.info(path);
  if (info.kind !== 'dataset') throw new Error('Pick a variable.');
  const shape = info.shape || [], nd = shape.length;
  if (info.compound || !info.numeric) throw new Error('Series need a numeric variable.');
  if (!Number.isInteger(axis) || axis < 0 || axis >= nd) throw new Error('This variable has ' + nd + ' dimensions.');
  const len = shape[axis];
  const max = Math.max(1, Math.min(MAX_SERIES_POINTS, opts.maxReadValues || MAX_SERIES_POINTS));
  const step = seriesStep(len, max);
  const count = Math.ceil(len / step);
  const idx = shape.map((n, d) => Math.min(Math.max(0, n - 1), Number.isInteger(index[d]) ? index[d] : 0));
  const r = backend.read(path, { rowAxis: axis, colAxis: -1, index: idx, rowStart: 0, rowCount: count, rowStep: step }, decode);
  const indices = Array.from({ length: r.rows }, (_, i) => i * step);
  const coordAt = (d, start, n, st) => {
    const c = info.coords && info.coords[d];
    if (!c) return null;
    try {
      const ci = backend.info(c);
      if (!ci.shape || ci.shape.length !== 1 || ci.shape[0] !== shape[d]) return null;
      const x = backend.read(c, { rowAxis: 0, colAxis: -1, index: [], rowStart: start, rowCount: n, rowStep: st }, true);
      return { path: c, values: x.values.map(v => v[0]), times: x.times ? x.times.map(v => v[0]) : null };
    } catch { return null; }
  };
  const fixed = [];
  for (let d = 0; d < nd; d++) {
    if (d === axis) continue;
    const c = coordAt(d, idx[d], 1, 1);
    const value = c ? (c.times && c.times[0] != null ? c.times[0] : c.values[0]) : null;
    fixed.push({ dim: info.dims[d], index: idx[d], value: value === undefined ? null : value });
  }
  return {
    path, name: info.name, units: (info.cf && info.cf.units) || null, dim: info.dims[axis], axis, len,
    start: 0, step, count: r.rows, indices,
    values: r.values.map(v => v[0]), times: r.times ? r.times.map(v => v[0]) : null,
    coord: coordAt(axis, 0, r.rows, step), fixed, decoded: !!r.decoded,
  };
}

/** "t2m at latitude 51.25, longitude -0.5 over time". Values are formatted by fmt (a number formatter). */
export function seriesTitle(s, fmt = String) {
  const at = s.fixed.map(f => `${f.dim} ${f.value === null || f.value === undefined ? '[' + f.index + ']' : (typeof f.value === 'number' ? fmt(f.value) : f.value)}`);
  return `${s.name}${at.length ? ' at ' + at.join(', ') : ''} over ${s.dim}`;
}
