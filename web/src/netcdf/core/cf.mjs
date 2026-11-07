// CF conventions helpers: packed data, fill values, and time decoding. Pure functions.

const num = v => (Array.isArray(v) || ArrayBuffer.isView(v)) ? (v.length ? Number(v[0]) : undefined) : (v === undefined || v === null || v === '' ? undefined : Number(v));
const arr = v => (Array.isArray(v) || ArrayBuffer.isView(v)) ? Array.from(v, Number) : (v === undefined || v === null ? [] : [Number(v)]);
const str = v => typeof v === 'string' ? v : (Array.isArray(v) && typeof v[0] === 'string' ? v.join('') : undefined);

/** attrs: { name: value } -> packing description, or null if nothing to decode. */
export function packing(attrs) {
  const p = {
    scale: num(attrs.scale_factor),
    offset: num(attrs.add_offset),
    fill: attrs._FillValue !== undefined ? arr(attrs._FillValue) : [],
    missing: attrs.missing_value !== undefined ? arr(attrs.missing_value) : [],
    validMin: undefined, validMax: undefined,
  };
  const vr = arr(attrs.valid_range);
  if (vr.length === 2) { p.validMin = vr[0]; p.validMax = vr[1]; }
  if (attrs.valid_min !== undefined) p.validMin = num(attrs.valid_min);
  if (attrs.valid_max !== undefined) p.validMax = num(attrs.valid_max);
  if (p.scale !== undefined && !Number.isFinite(p.scale)) p.scale = undefined;
  if (p.offset !== undefined && !Number.isFinite(p.offset)) p.offset = undefined;
  const any = p.scale !== undefined || p.offset !== undefined || p.fill.length || p.missing.length || p.validMin !== undefined || p.validMax !== undefined;
  return any ? p : null;
}

export const FILL = null;

/** Decode one raw value. Returns a number, null for fill/missing/out-of-range, or NaN/Infinity as is. */
export function decodeValue(raw, p) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'bigint') raw = Number(raw);
  if (typeof raw !== 'number') return raw;
  if (!p) return raw;
  for (const f of p.fill) if (raw === f || (Number.isNaN(f) && Number.isNaN(raw))) return FILL;
  for (const f of p.missing) if (raw === f) return FILL;
  if (p.validMin !== undefined && raw < p.validMin) return FILL;
  if (p.validMax !== undefined && raw > p.validMax) return FILL;
  let v = raw;
  if (p.scale !== undefined) v *= p.scale;
  if (p.offset !== undefined) v += p.offset;
  return v;
}

const UNIT_MS = {
  ms: 1, msec: 1, msecs: 1, millisecond: 1, milliseconds: 1,
  us: 1e-3, usec: 1e-3, microsecond: 1e-3, microseconds: 1e-3,
  s: 1e3, sec: 1e3, secs: 1e3, second: 1e3, seconds: 1e3,
  min: 6e4, mins: 6e4, minute: 6e4, minutes: 6e4,
  h: 36e5, hr: 36e5, hrs: 36e5, hour: 36e5, hours: 36e5,
  d: 864e5, day: 864e5, days: 864e5,
};

/** "hours since 1900-01-01 00:00:00.0" -> { unit, ms, epoch:{y,m,d,H,M,S,tz} } or null. */
export function parseTimeUnits(units) {
  if (typeof units !== 'string') return null;
  const m = /^\s*([a-zA-Z]+)\s+(?:since|after|from)\s+(-?\d{1,6})-(\d{1,2})(?:-(\d{1,2}))?(?:[ T]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d*)?))?)?\s*(Z|UTC|GMT|[+-]\d{1,2}(?::?\d{2})?)?\s*$/i.exec(units);
  if (!m) return null;
  const unit = m[1].toLowerCase();
  let tz = 0;
  if (m[8] && /^[+-]/.test(m[8])) {
    const t = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(m[8]);
    tz = (t[1] === '-' ? -1 : 1) * (Number(t[2]) * 60 + Number(t[3] || 0));
  }
  const epoch = { y: Number(m[2]), m: Number(m[3]), d: Number(m[4] || 1), H: Number(m[5] || 0), M: Number(m[6] || 0), S: Number(m[7] || 0), tz };
  if (epoch.m < 1 || epoch.m > 12 || epoch.d < 1 || epoch.d > 31) return null;
  if (UNIT_MS[unit] !== undefined) return { unit, ms: UNIT_MS[unit], epoch };
  if (/^(month|months|year|years|yr|yrs)$/.test(unit)) return { unit: unit.startsWith('m') ? 'months' : 'years', ms: undefined, epoch };
  return null;
}

const NOLEAP = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const ALLLEAP = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const pad = (n, w = 2) => String(Math.trunc(Math.abs(n))).padStart(w, '0');

export function normCalendar(cal) {
  const c = String(cal || 'standard').toLowerCase().trim();
  if (c === 'gregorian' || c === 'standard' || c === 'proleptic_gregorian' || c === 'julian' || c === '') return 'standard';
  if (c === 'noleap' || c === '365_day') return 'noleap';
  if (c === 'all_leap' || c === '366_day') return 'all_leap';
  if (c === '360_day') return '360_day';
  return 'unknown';
}

function fmt(y, mo, d, H, M, S) {
  const ys = y < 0 ? '-' + pad(-y, 4) : pad(y, 4);
  let out = `${ys}-${pad(mo)}-${pad(d)}`;
  if (H || M || S) {
    out += ` ${pad(H)}:${pad(M)}`;
    if (S) out += ':' + (Number.isInteger(S) ? pad(S) : S.toFixed(3).padStart(6, '0'));
  }
  return out;
}

/** Decode one time value to "YYYY-MM-DD[ HH:MM[:SS]]". Returns null when it cannot. */
export function decodeTime(value, tu, calendar) {
  if (!tu || value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  value = Number(value);
  const cal = normCalendar(calendar);
  const e = tu.epoch;
  if (cal === 'unknown') return null;
  if (tu.ms === undefined) {
    // months/years: exact only in 360_day; otherwise use whole calendar months, which is what most climate files mean.
    const months = tu.unit === 'years' ? value * 12 : value;
    if (!Number.isInteger(months)) {
      if (cal !== '360_day') return null;
      return decodeTime(months * 30, { ms: 864e5, epoch: e }, cal);
    }
    let total = e.y * 12 + (e.m - 1) + months;
    const y = Math.floor(total / 12), mo = total - y * 12 + 1;
    return fmt(y, mo, e.d, e.H, e.M, e.S);
  }
  const offMs = value * tu.ms - e.tz * 6e4;
  if (cal === 'standard') {
    const base = Date.UTC(0, e.m - 1, e.d, e.H, e.M, 0, 0) + e.S * 1000;
    const dt = new Date(base);
    dt.setUTCFullYear(e.y);
    const t = dt.getTime() + offMs;
    if (!Number.isFinite(t) || Math.abs(t) > 8.64e15) return null;
    const r = new Date(t);
    const S = r.getUTCSeconds() + r.getUTCMilliseconds() / 1000;
    return fmt(r.getUTCFullYear(), r.getUTCMonth() + 1, r.getUTCDate(), r.getUTCHours(), r.getUTCMinutes(), S);
  }
  // Fixed-length-year calendars: count days from year 0.
  const ml = cal === 'noleap' ? NOLEAP : cal === 'all_leap' ? ALLLEAP : null;
  const yearDays = cal === '360_day' ? 360 : cal === 'noleap' ? 365 : 366;
  const dayOfYear = (mo, d) => {
    if (!ml) return (mo - 1) * 30 + (d - 1);
    let n = 0; for (let i = 0; i < mo - 1; i++) n += ml[i]; return n + d - 1;
  };
  const epochMs = ((e.y * yearDays + dayOfYear(e.m, e.d)) * 86400 + e.H * 3600 + e.M * 60 + e.S) * 1000;
  let t = epochMs + offMs;
  const dayMs = 864e5;
  let days = Math.floor(t / dayMs);
  let rem = t - days * dayMs;
  const y = Math.floor(days / yearDays);
  let doy = days - y * yearDays;
  let mo = 1, d;
  if (!ml) { mo = Math.floor(doy / 30) + 1; d = doy % 30 + 1; } else {
    while (doy >= ml[mo - 1]) { doy -= ml[mo - 1]; mo++; }
    d = doy + 1;
  }
  const H = Math.floor(rem / 36e5); rem -= H * 36e5;
  const M = Math.floor(rem / 6e4); rem -= M * 6e4;
  const S = Math.round(rem) / 1000;
  return fmt(y, mo, d, H, M, S);
}

/** Summary of the CF attributes that the UI shows on top. */
export function cfSummary(attrs) {
  const s = {};
  for (const k of ['long_name', 'standard_name', 'units', 'calendar', 'coordinates', 'axis', 'positive', 'cell_methods', 'grid_mapping', 'bounds']) {
    const v = str(attrs[k]);
    if (v !== undefined) s[k] = v;
  }
  const p = packing(attrs);
  if (p) s.packing = p;
  const tu = parseTimeUnits(s.units);
  if (tu) s.time = { unit: tu.unit, calendar: normCalendar(s.calendar) };
  return s;
}
