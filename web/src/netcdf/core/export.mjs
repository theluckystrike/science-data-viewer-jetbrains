// Turns one 2D (or 1D) slice of a variable into CSV or JSON text for "Export slice".
// Pure functions: no I/O, so the tests can call them with plain objects.

/** Label for index i of a coordinate read ({ values, times }) or the index itself. */
export function coordAt(coord, i) {
  if (!coord) return i;
  if (coord.times && coord.times[i] != null) return coord.times[i];
  const v = coord.values ? coord.values[i] : undefined;
  return v === undefined ? i : v;
}

/** File name suggested in the save dialog, e.g. t2m_time2.csv. Only safe characters are kept. */
export function exportFileName(info, view, ext) {
  const nd = (info.shape || []).length;
  const parts = [info.name || 'data'];
  for (let d = 0; d < nd; d++) {
    if (d === view.rowAxis || d === view.colAxis) continue;
    parts.push(`${(info.dims && info.dims[d]) || 'dim' + d}${(view.index && view.index[d]) || 0}`);
  }
  const base = parts.join('_').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[._]+/, '').slice(0, 120) || 'data';
  return `${base}.${ext}`;
}

// A text cell that starts with one of these could run as a formula when the CSV is opened in a spreadsheet.
const FORMULA = /^[=+\-@\t\r]/;

/** One value -> CSV field. Numbers keep full precision; fill values become empty fields. */
export function csvField(v, fromText = false) {
  if (v === null || v === undefined) return '';
  let s;
  if (typeof v === 'number') s = String(v);
  else if (typeof v === 'boolean') s = v ? 'true' : 'false';
  else if (typeof v === 'string') s = fromText && FORMULA.test(v) ? "'" + v : v;
  else s = JSON.stringify(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// Values the reader turned into strings but that are really numbers.
const SPECIAL = new Set(['NaN', 'Inf', '-Inf']);
// Headers and coordinate labels: text from the file gets the same formula guard as text cells.
const label = x => csvField(x, typeof x === 'string' && !SPECIAL.has(x));
const cell = (data, r, c) => {
  if (data.times && data.times[r] && data.times[r][c] != null) return { v: data.times[r][c], text: false };
  const v = data.values[r][c];
  return { v, text: typeof v === 'string' && !SPECIAL.has(v) };
};

/**
 * slice = { info, view: { rowAxis, colAxis }, data (worker read result), rowCoord, colCoord, fixed: [{ dim, index, value }] }
 * Returns CSV text: a header row, then one line per row. 2D slices keep the grid layout of the Table tab,
 * with the column coordinate in the header and the row coordinate in the first column.
 */
export function toCsv(slice) {
  const { info, view, data, rowCoord, colCoord } = slice;
  const nd = (info.shape || []).length;
  const units = info.cf && info.cf.units;
  const valueName = units ? `${info.name} (${units})` : info.name;
  const lines = [];
  const line = fields => lines.push(fields.join(','));
  if (nd === 0) {
    line([label(valueName)]);
    const c = cell(data, 0, 0);
    line([csvField(c.v, c.text)]);
    return lines.join('\n') + '\n';
  }
  const rowDim = info.dims[view.rowAxis];
  const r0 = data.start[view.rowAxis], rs = data.step[view.rowAxis];
  if (info.compound) {
    line([label(rowDim), ...info.compound.map(label)]);
    for (let r = 0; r < data.rows; r++) {
      const rec = data.values[r][0];
      line([label(coordAt(rowCoord, r0 + r * rs)), ...(Array.isArray(rec) ? rec : [rec]).map(label)]);
    }
    return lines.join('\n') + '\n';
  }
  if (view.colAxis < 0) {
    line([label(rowDim), label(valueName)]);
    for (let r = 0; r < data.rows; r++) {
      const c = cell(data, r, 0);
      line([label(coordAt(rowCoord, r0 + r * rs)), csvField(c.v, c.text)]);
    }
    return lines.join('\n') + '\n';
  }
  const colDim = info.dims[view.colAxis];
  const c0 = data.start[view.colAxis], cs = data.step[view.colAxis];
  const head = [label(`${rowDim} \\ ${colDim}`)];
  for (let c = 0; c < data.cols; c++) head.push(label(coordAt(colCoord, c0 + c * cs)));
  line(head);
  for (let r = 0; r < data.rows; r++) {
    const f = [label(coordAt(rowCoord, r0 + r * rs))];
    for (let c = 0; c < data.cols; c++) { const x = cell(data, r, c); f.push(csvField(x.v, x.text)); }
    line(f);
  }
  return lines.join('\n') + '\n';
}

/** JSON with the values and everything needed to know where they came from. */
export function toJson(slice) {
  const { info, view, data, rowCoord, colCoord, fixed, fileName } = slice;
  const nd = (info.shape || []).length;
  const twoD = nd >= 2 && view.colAxis >= 0 && !info.compound;
  const r0 = nd ? data.start[view.rowAxis] : 0, rs = nd ? data.step[view.rowAxis] : 1;
  const c0 = twoD ? data.start[view.colAxis] : 0, cs = twoD ? data.step[view.colAxis] : 1;
  const out = {
    file: fileName,
    variable: info.path,
    dtype: info.dtype,
    shape: info.shape,
    dims: info.dims || [],
    units: (info.cf && info.cf.units) || null,
    decoded: !!data.decoded,
    rowDim: nd ? info.dims[view.rowAxis] : null,
    colDim: twoD ? info.dims[view.colAxis] : null,
    fixed: fixed || [],
  };
  if (nd) out.rowCoords = Array.from({ length: data.rows }, (_, r) => coordAt(rowCoord, r0 + r * rs));
  if (twoD) out.colCoords = Array.from({ length: data.cols }, (_, c) => coordAt(colCoord, c0 + c * cs));
  if (info.compound) out.fields = info.compound;
  const pick = (grid) => (nd === 0 ? grid[0][0] : twoD ? grid : grid.map(row => row[0]));
  out.values = pick(data.values);
  if (data.times) out.times = pick(data.times);
  return JSON.stringify(out, null, 1) + '\n';
}

/**
 * "Copy as CSV" of a series: two columns, the coordinate (decoded time or value, or the index) and the value.
 * series = readSeries() result. Text from the file gets the spreadsheet formula guard.
 */
export function seriesCsv(series) {
  const units = series.units;
  const valueName = units ? `${series.name} (${units})` : series.name;
  const lines = [[label(series.dim), label(valueName)].join(',')];
  for (let i = 0; i < series.values.length; i++) {
    const x = coordAt(series.coord, i);
    const v = series.times && series.times[i] != null ? series.times[i] : series.values[i];
    const text = typeof v === 'string' && !(series.times && series.times[i] != null) && !SPECIAL.has(v);
    lines.push([label(series.coord ? x : series.indices[i]), csvField(v, text)].join(','));
  }
  return lines.join('\n') + '\n';
}
