// Statistics over decoded values. null = fill/missing. Strings are ignored.
export function stats(values) {
  let n = 0, min = Infinity, max = -Infinity, mean = 0, m2 = 0, nan = 0, inf = 0, fill = 0, other = 0;
  for (const v0 of values) {
    if (v0 === null || v0 === undefined) { fill++; continue; }
    const v = typeof v0 === 'bigint' ? Number(v0) : v0;
    if (typeof v !== 'number') { other++; continue; }
    if (Number.isNaN(v)) { nan++; continue; }
    if (!Number.isFinite(v)) { inf++; continue; }
    n++;
    if (v < min) min = v;
    if (v > max) max = v;
    const d = v - mean; mean += d / n; m2 += d * (v - mean);
  }
  return n ? { count: n, min, max, mean, std: n > 1 ? Math.sqrt(m2 / (n - 1)) : 0, nan, inf, fill, other } : { count: 0, min: null, max: null, mean: null, std: null, nan, inf, fill, other };
}
