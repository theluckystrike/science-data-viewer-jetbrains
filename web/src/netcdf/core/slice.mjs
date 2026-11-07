// Turns a 2D view of an N-D variable into a hyperslab (start/count/step per dimension) and back.
// Pure functions: no I/O. Used by the worker for every read and by the tests.

export function product(a) { return a.reduce((p, x) => p * x, 1); }

const isInt = n => Number.isInteger(n) && n >= 0;

/**
 * view = { rowAxis, colAxis (or -1 for 1D), index: [per-dim fixed index], rowStart, rowCount, colStart, colCount, rowStep, colStep }
 * Returns { start, count, step, transpose, rows, cols }.
 */
export function viewToHyperslab(shape, view) {
  const n = shape.length;
  if (n === 0) return { start: [], count: [], step: [], transpose: false, rows: 1, cols: 1 };
  const rowAxis = view.rowAxis ?? 0;
  const colAxis = view.colAxis ?? (n > 1 ? n - 1 : -1);
  if (!isInt(rowAxis) || rowAxis >= n) throw new Error('bad rowAxis');
  if (colAxis !== -1 && (!isInt(colAxis) || colAxis >= n || colAxis === rowAxis)) throw new Error('bad colAxis');
  const start = [], count = [], step = [];
  for (let d = 0; d < n; d++) {
    if (d === rowAxis) {
      const st = Math.max(1, view.rowStep || 1);
      const s = clamp(view.rowStart || 0, 0, Math.max(0, shape[d] - 1));
      const c = Math.max(0, Math.min(view.rowCount ?? shape[d], Math.ceil((shape[d] - s) / st)));
      start.push(s); count.push(c); step.push(st);
    } else if (d === colAxis) {
      const st = Math.max(1, view.colStep || 1);
      const s = clamp(view.colStart || 0, 0, Math.max(0, shape[d] - 1));
      const c = Math.max(0, Math.min(view.colCount ?? shape[d], Math.ceil((shape[d] - s) / st)));
      start.push(s); count.push(c); step.push(st);
    } else {
      const i = view.index && Number.isFinite(view.index[d]) ? clamp(Math.trunc(view.index[d]), 0, Math.max(0, shape[d] - 1)) : 0;
      start.push(i); count.push(shape[d] === 0 ? 0 : 1); step.push(1);
    }
  }
  const rows = count[rowAxis];
  const cols = colAxis === -1 ? 1 : count[colAxis];
  return { start, count, step, transpose: colAxis !== -1 && colAxis < rowAxis, rows, cols };
}

function clamp(v, lo, hi) { v = Math.trunc(Number(v) || 0); return v < lo ? lo : v > hi ? hi : v; }

/** Flat row-major result of a hyperslab -> array of rows (rows x cols), honoring transpose. */
export function toRows(flat, hs) {
  const { rows, cols, transpose } = hs;
  const out = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = transpose ? flat[c * rows + r] : flat[r * cols + c];
    out[r] = row;
  }
  return out;
}

/** h5wasm wants [[start, end, step]] with an exclusive end. */
export function toH5Ranges(hs) {
  return hs.start.map((s, d) => {
    const c = hs.count[d], st = hs.step[d];
    return c === 0 ? [s, s] : [s, s + (c - 1) * st + 1, st];
  });
}

/** Pick a step so that a dimension of length len fits into max samples. */
export function stepFor(len, max) { return len <= max ? 1 : Math.ceil(len / max); }

/** Iterate every element index of a hyperslab in row-major order. cb(idx[]) where idx is reused. */
export function forEachIndex(hs, cb) {
  const n = hs.start.length;
  if (n === 0) { cb([]); return; }
  if (hs.count.some(c => c === 0)) return;
  const k = new Array(n).fill(0);
  const idx = hs.start.slice();
  for (;;) {
    cb(idx);
    let d = n - 1;
    while (d >= 0) {
      k[d]++;
      if (k[d] < hs.count[d]) { idx[d] = hs.start[d] + k[d] * hs.step[d]; break; }
      k[d] = 0; idx[d] = hs.start[d]; d--;
    }
    if (d < 0) return;
  }
}
