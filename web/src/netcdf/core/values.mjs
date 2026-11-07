// Converts raw library values into JSON-safe values for postMessage, and describes HDF5 types.

/** One raw element -> JSON-safe value. NaN/Infinity become strings, BigInt becomes Number (or string if unsafe). */
export function jsonSafe(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : Number.isNaN(v) ? 'NaN' : v > 0 ? 'Inf' : '-Inf';
  if (typeof v === 'bigint') return (v <= BigInt(Number.MAX_SAFE_INTEGER) && v >= BigInt(Number.MIN_SAFE_INTEGER)) ? Number(v) : v.toString();
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v;
  if (v instanceof Uint8Array && v.length > 64) return `<${v.length} bytes>`;
  if (Array.isArray(v) || ArrayBuffer.isView(v)) return Array.from(v, jsonSafe);
  if (typeof v === 'object') return '<' + (v.constructor && v.constructor.name || 'object') + '>';
  return String(v);
}

/** Attribute value -> short display value (arrays kept up to 64 items). */
export function attrValue(v) {
  if (Array.isArray(v) || ArrayBuffer.isView(v)) {
    const a = Array.from(v.length > 64 ? v.slice(0, 64) : v, jsonSafe);
    return v.length > 64 ? { truncated: v.length, items: a } : a;
  }
  return jsonSafe(v);
}

const INT = { 1: '8', 2: '16', 4: '32', 8: '64' };

/** h5wasm Dataset.metadata -> "int16", "float32", "string", "compound{a: int32, b: float64}", ... */
export function describeH5Type(m) {
  if (!m) return 'unknown';
  switch (m.type) {
    case 0: return (m.signed ? 'int' : 'uint') + (INT[m.size] || m.size * 8);
    case 1: return 'float' + m.size * 8;
    case 2: return 'time';
    case 3: return m.vlen ? 'string' : `string(${m.size})`;
    case 4: return `bitfield${m.size * 8}`;
    case 5: return `opaque(${m.size})`;
    case 6: {
      const mem = (m.compound_type && m.compound_type.members) || [];
      return 'compound{' + mem.map(x => `${x.name}: ${describeH5Type(x)}`).join(', ') + '}';
    }
    case 7: return 'reference';
    case 8: {
      const names = m.enum_type && m.enum_type.members ? Object.keys(m.enum_type.members) : [];
      if (names.length === 2 && names.includes('FALSE') && names.includes('TRUE')) return 'bool';
      return 'enum{' + names.slice(0, 8).join(', ') + (names.length > 8 ? ', ...' : '') + '}';
    }
    case 9: return 'vlen<' + describeH5Type(m.vlen_type) + '>';
    case 10: return describeH5Type(m.array_type) + '[' + ((m.array_type && m.array_type.shape) || []).join('x') + ']';
    default: return 'unknown';
  }
}

export function isNumericH5(m) { return m && (m.type === 0 || m.type === 1 || m.type === 8 || m.type === 4); }

const FILTER_NAMES = { 1: 'deflate (gzip)', 2: 'shuffle', 3: 'fletcher32', 4: 'szip', 5: 'nbit', 6: 'scaleoffset', 307: 'bzip2', 32000: 'lzf', 32001: 'blosc', 32004: 'lz4', 32008: 'bitshuffle', 32013: 'zfp', 32015: 'zstd', 32017: 'sz', 32026: 'blosc2' };

/** h5wasm filters -> [{id, name, level?}] with readable names. */
export function describeFilters(filters) {
  return (filters || []).map(f => {
    const name = FILTER_NAMES[f.id] || f.name || `filter ${f.id}`;
    const out = { id: f.id, name };
    if (f.id === 1 && f.cd_values && f.cd_values.length) out.level = f.cd_values[0];
    return out;
  });
}

export function formatBytes(n) {
  if (!Number.isFinite(n)) return '?';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i ? n.toFixed(n < 10 ? 2 : 1) : String(n)) + ' ' + u[i];
}
