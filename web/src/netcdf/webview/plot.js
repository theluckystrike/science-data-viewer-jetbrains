// Canvas plots: 1D line plot and 2D heatmap with a colour bar, on screen and as PNG pictures for "Save PNG".
// Values never become HTML: they are drawn as canvas text or pixels.
import { colormap, colorRange, makeScale, colorbarTicks, ticks, fmtNum } from './util.js';

function css(name, dflt) { return getComputedStyle(document.body).getPropertyValue(name).trim() || dflt; }
const themeColors = () => ({ fg: css('--vscode-foreground', '#ccc'), grid: css('--vscode-panel-border', '#444'), line: css('--vscode-charts-blue', '#3794ff') });
// Saved pictures are meant for slides and papers: dark text on white, whatever the editor theme.
const PNG_COLORS = { fg: '#222222', grid: '#d0d0d0', line: '#1f77b4', bg: '#ffffff' };
const PNG_FONT = '11px sans-serif';

function setup(canvas, w, h) {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
  const g = canvas.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.font = `11px ${css('--vscode-font-family', 'sans-serif')}`;
  return g;
}

/** Offscreen canvas at 2x for a picture of W x H logical pixels, white background and a title line. */
function pngCanvas(W, H, title) {
  const c = document.createElement('canvas');
  c.width = Math.round(W * 2); c.height = Math.round(H * 2);
  const g = c.getContext('2d');
  g.setTransform(2, 0, 0, 2, 0, 0);
  g.fillStyle = PNG_COLORS.bg; g.fillRect(0, 0, W, H);
  g.fillStyle = PNG_COLORS.fg; g.textAlign = 'left';
  g.font = 'bold 13px sans-serif';
  g.fillText(clip(title, 140), 10, 20);
  g.font = PNG_FONT;
  return { c, g };
}
const clip = (s, n) => { s = String(s == null ? '' : s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

/** Draws a line plot at the origin of g, W x H. Returns { hit(mx) } or null when there is nothing to draw. */
function drawLine(g, W, H, xs, ys, opts, col) {
  const L = 64, R = 16, T = 14, B = 40;
  let y0 = Infinity, y1 = -Infinity;
  for (const y of ys) if (typeof y === 'number' && Number.isFinite(y)) { if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const xnum = xs.every(x => typeof x === 'number' && Number.isFinite(x));
  const X = xnum ? xs : xs.map((_, i) => i);
  let x0 = Infinity, x1 = -Infinity;
  for (const x of X) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
  if (!Number.isFinite(y0)) { g.fillStyle = col.fg; g.fillText('No finite values to plot.', L, T + 20); return null; }
  if (y0 === y1) { y0 -= 1; y1 += 1; }
  const px = x => L + (x1 === x0 ? 0.5 : (x - x0) / (x1 - x0)) * (W - L - R);
  const py = y => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  g.strokeStyle = col.grid; g.fillStyle = col.fg; g.lineWidth = 1;
  for (const t of ticks(y0, y1, 5)) { const y = py(t); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke(); g.textAlign = 'right'; g.fillText(fmtNum(t), L - 6, y + 4); }
  g.textAlign = 'center';
  if (xnum) for (const t of ticks(x0, x1, 6)) g.fillText(fmtNum(t), px(t), H - B + 16);
  else { const n = xs.length; const k = Math.min(5, n); for (let j = 0; j < k; j++) { const i = k === 1 ? 0 : Math.round(j * (n - 1) / (k - 1)); g.fillText(clip(xs[i], 16), px(i), H - B + 16); } }
  if (opts.xLabel) g.fillText(clip(opts.xLabel, 80), (L + W - R) / 2, H - 6);
  if (opts.yLabel) { g.save(); g.translate(11, (T + H - B) / 2); g.rotate(-Math.PI / 2); g.fillText(clip(opts.yLabel, 50), 0, 0); g.restore(); }
  g.strokeStyle = col.line; g.lineWidth = 1.5; g.beginPath();
  let pen = false, alone = [];
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    if (typeof y !== 'number' || !Number.isFinite(y)) { pen = false; continue; }
    if (pen) g.lineTo(px(X[i]), py(y)); else { g.moveTo(px(X[i]), py(y)); pen = true; }
    const prev = ys[i - 1], next = ys[i + 1];
    if (!(typeof prev === 'number' && Number.isFinite(prev)) && !(typeof next === 'number' && Number.isFinite(next))) alone.push(i);
  }
  g.stroke();
  // Points with no neighbour (or very short series) would not show as a line: mark them.
  if (ys.length <= 60) alone = ys.map((_, i) => i).filter(i => typeof ys[i] === 'number' && Number.isFinite(ys[i]));
  g.fillStyle = col.line;
  for (const i of alone) { g.beginPath(); g.arc(px(X[i]), py(ys[i]), 2.5, 0, Math.PI * 2); g.fill(); }
  return { hit(mx) { const t = (mx - L) / (W - L - R); if (t < 0 || t > 1) return null; let best = 0, bd = Infinity; const xv = x0 + t * (x1 - x0); for (let i = 0; i < X.length; i++) { const d = Math.abs(X[i] - xv); if (d < bd) { bd = d; best = i; } } return best; } };
}

export function linePlot(canvas, xs, ys, opts = {}) {
  const W = opts.width || 760, H = opts.height || 320;
  const g = setup(canvas, W, H);
  return drawLine(g, W, H, xs, ys, opts, themeColors());
}

/** PNG data URL of a line plot with a title line, at 2x. */
export function linePng(xs, ys, opts = {}) {
  const W = 900, H = 360, TT = 30;
  const { c, g } = pngCanvas(W, H + TT, opts.title || '');
  g.translate(0, TT);
  drawLine(g, W, H, xs, ys, opts, PNG_COLORS);
  return c.toDataURL('image/png');
}

/** Cell size for a heatmap of nr x nc cells in maxW x maxH (the colour bar takes the last 96 px of the width). */
export function heatmapLayout(nr, nc, maxW = 760, maxH = 340) {
  const CB = 96;
  const scale = Math.max(0.25, Math.min((maxW - CB) / Math.max(1, nc), maxH / Math.max(1, nr), 8));
  return { scale, w: Math.max(1, Math.round(nc * scale)), h: Math.max(1, Math.round(nr * scale)), CB };
}

/** Pixels of the heatmap image at one pixel per cell. Non-finite values (and values <= 0 on a log scale) are no-data grey. */
function heatImage(rows, nr, nc, cmap, toT) {
  const img = new ImageData(Math.max(1, nc), Math.max(1, nr));
  const d = img.data;
  for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
    const t = toT(rows[r][c]), k = (r * nc + c) * 4;
    if (t === null || !Number.isFinite(t)) { d[k] = 128; d[k + 1] = 128; d[k + 2] = 128; d[k + 3] = 90; continue; }
    const [R, G, B] = cmap(t);
    d[k] = R; d[k + 1] = G; d[k + 2] = B; d[k + 3] = 255;
  }
  const off = document.createElement('canvas'); off.width = Math.max(1, nc); off.height = Math.max(1, nr);
  off.getContext('2d').putImageData(img, 0, 0);
  return off;
}

function colorbar(g, x, y, bh, cmap, range, fg) {
  for (let i = 0; i < bh; i++) { const [R, G, B] = cmap(1 - i / bh); g.fillStyle = `rgb(${R},${G},${B})`; g.fillRect(x, y + i, 12, 1); }
  const toT = makeScale(range.lo, range.hi, range.log);
  g.fillStyle = fg; g.textAlign = 'left';
  let lastY = -Infinity;
  const marks = colorbarTicks(range.lo, range.hi, range.log);
  // Both ends first so they always show; inner ticks only where they do not overlap.
  const order = [marks[marks.length - 1], marks[0], ...marks.slice(1, -1)];
  const used = [];
  for (const v of order) {
    const t = toT(v); if (t === null) continue;
    const yy = y + (1 - t) * bh;
    if (used.some(u => Math.abs(u - yy) < 13)) continue;
    used.push(yy); lastY = yy;
    g.fillRect(x + 12, Math.round(yy), 4, 1);
    g.fillText(fmtNum(v), x + 19, Math.min(y + bh + 4, Math.max(y + 4, yy + 4)));
  }
  return lastY;
}

/**
 * Heatmap with a colour bar. opts: { width, height, cmap (function t -> rgb), range ({ lo, hi, log }) }.
 * Cell (r, c) covers canvas CSS pixels [c * scale, (c + 1) * scale) x [r * scale, (r + 1) * scale).
 */
export function heatmap(canvas, rows, opts = {}) {
  const nr = rows.length, nc = nr ? rows[0].length : 0;
  const lay = heatmapLayout(nr, nc, opts.width || 760, opts.height || 340);
  const { scale, w, h, CB } = lay;
  const g = setup(canvas, w + CB, Math.max(h, 120));
  const fg = css('--vscode-foreground', '#ccc');
  let range = opts.range;
  if (!range) { const flat = []; for (const r of rows) for (const v of r) flat.push(v); const p = colorRange(flat); range = p && { ...p, log: false }; }
  if (!range) { g.fillStyle = fg; g.fillText('No finite values to plot.', 8, 20); return null; }
  const cmap = opts.cmap || colormap('viridis');
  g.imageSmoothingEnabled = false;
  g.drawImage(heatImage(rows, nr, nc, cmap, makeScale(range.lo, range.hi, range.log)), 0, 0, w, h);
  colorbar(g, w + 14, 10, Math.max(h, 120) - 20, cmap, range, fg);
  return { range, scale, rows: nr, cols: nc, hit(mx, my) { const c = Math.floor(mx / scale), r = Math.floor(my / scale); return r >= 0 && c >= 0 && r < nr && c < nc ? { r, c } : null; } };
}

/**
 * PNG data URL of a heatmap at 2x: title line, the image, row and column axis labels, and the colour bar.
 * opts: { title, cmap, range, rowLabel, colLabel, rowTick(i) -> text, colTick(i) -> text, units }
 */
export function heatmapPng(rows, opts) {
  const nr = rows.length, nc = nr ? rows[0].length : 0;
  const lay = heatmapLayout(nr, nc, 900, 520);
  const { w, h, scale } = lay;
  const L = 86, T = 34, B = 44, CB = 110;
  const W = L + w + CB, H = T + Math.max(h, 160) + B;
  const { c, g } = pngCanvas(W, H, opts.title || '');
  g.imageSmoothingEnabled = false;
  const range = opts.range;
  g.drawImage(heatImage(rows, nr, nc, opts.cmap, makeScale(range.lo, range.hi, range.log)), L, T, w, h);
  g.strokeStyle = PNG_COLORS.fg; g.lineWidth = 1; g.strokeRect(L - 0.5, T - 0.5, w + 1, h + 1);
  g.fillStyle = PNG_COLORS.fg;
  const marks = n => { const k = Math.min(5, n); return k <= 1 ? [0] : Array.from({ length: k }, (_, j) => Math.round(j * (n - 1) / (k - 1))); };
  g.textAlign = 'center';
  for (const i of marks(nc)) { const x = L + (i + 0.5) * scale; g.fillRect(Math.round(x), T + h, 1, 4); g.fillText(clip(opts.colTick ? opts.colTick(i) : i, 18), x, T + h + 16); }
  if (opts.colLabel) g.fillText(clip(opts.colLabel, 60), L + w / 2, T + h + 34);
  g.textAlign = 'right';
  for (const i of marks(nr)) { const y = T + (i + 0.5) * scale; g.fillRect(L - 4, Math.round(y), 4, 1); g.fillText(clip(opts.rowTick ? opts.rowTick(i) : i, 12), L - 6, y + 4); }
  if (opts.rowLabel) { g.save(); g.translate(12, T + h / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(clip(opts.rowLabel, 40), 0, 0); g.restore(); }
  const bh = Math.max(h, 160) - 10;
  colorbar(g, L + w + 16, T, bh, opts.cmap, range, PNG_COLORS.fg);
  if (opts.units) { g.textAlign = 'left'; g.fillText(clip(opts.units, 16), L + w + 16, T + bh + 18); }
  if (range.log) { g.textAlign = 'left'; g.fillText('log scale', L + w + 16, T + bh + (opts.units ? 32 : 18)); }
  return c.toDataURL('image/png');
}
