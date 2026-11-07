import test from 'node:test';
import assert from 'node:assert/strict';
import { packing, decodeValue, parseTimeUnits, decodeTime, normCalendar, cfSummary } from '../../src/netcdf/core/cf.mjs';

test('packing reads scale, offset, fill, missing and valid range', () => {
  const p = packing({ scale_factor: [0.5], add_offset: 10, _FillValue: -1, missing_value: [-2, -3], valid_range: [0, 100] });
  assert.deepEqual([p.scale, p.offset, p.fill, p.missing, p.validMin, p.validMax], [0.5, 10, [-1], [-2, -3], 0, 100]);
  assert.equal(packing({ units: 'K' }), null);
});

test('decodeValue unpacks and masks', () => {
  const p = packing({ scale_factor: 0.0025, add_offset: 260, _FillValue: -32767 });
  assert.equal(decodeValue(-32767, p), null);
  assert.ok(Math.abs(decodeValue(400, p) - 261) < 1e-9);
  assert.equal(decodeValue(5, null), 5);
  assert.equal(decodeValue(5n, null), 5);
  assert.ok(Number.isNaN(decodeValue(NaN, packing({ scale_factor: 2 }))));
  assert.equal(decodeValue(NaN, packing({ _FillValue: NaN })), null);
  assert.equal(decodeValue(150, packing({ valid_max: 100 })), null);
});

test('parseTimeUnits handles common CF forms', () => {
  assert.equal(parseTimeUnits('hours since 1900-01-01 00:00:00.0').ms, 36e5);
  assert.deepEqual(parseTimeUnits('days since 2000-1-1').epoch, { y: 2000, m: 1, d: 1, H: 0, M: 0, S: 0, tz: 0 });
  assert.equal(parseTimeUnits('seconds since 1970-01-01T00:00:00Z').unit, 'seconds');
  assert.equal(parseTimeUnits('minutes since 2020-06-01 12:00 +05:30').epoch.tz, 330);
  assert.equal(parseTimeUnits('months since 1850-01').unit, 'months');
  assert.equal(parseTimeUnits('K'), null);
  assert.equal(parseTimeUnits('days since 2000-13-01'), null);
  assert.equal(parseTimeUnits(undefined), null);
});

test('decodeTime: standard, noleap, 360_day, all_leap, months', () => {
  const h = parseTimeUnits('hours since 1900-01-01 00:00:00');
  assert.equal(decodeTime(1095000, h, 'gregorian'), '2024-12-01');
  assert.equal(decodeTime(1095006, h, 'standard'), '2024-12-01 06:00');
  const s = parseTimeUnits('seconds since 1970-01-01');
  assert.equal(decodeTime(1.5, s), '1970-01-01 00:00:01.500');
  const d = parseTimeUnits('days since 2000-01-01');
  assert.equal(decodeTime(9490, d, 'noleap'), '2026-01-01');
  assert.equal(decodeTime(59, d, '365_day'), '2000-03-01');
  assert.equal(decodeTime(59, d, 'standard'), '2000-02-29');
  assert.equal(decodeTime(59, d, 'all_leap'), '2000-02-29');
  assert.equal(decodeTime(360, d, '360_day'), '2001-01-01');
  assert.equal(decodeTime(45, d, '360_day'), '2000-02-16');
  const mo = parseTimeUnits('months since 1850-01-01');
  assert.equal(decodeTime(13, mo, 'standard'), '1851-02-01');
  assert.equal(decodeTime(0.5, mo, 'standard'), null);
  assert.equal(decodeTime(10, d, 'weird_calendar'), null);
  assert.equal(decodeTime(null, d), null);
  const tz = parseTimeUnits('hours since 2020-01-01 00:00 +02:00');
  assert.equal(decodeTime(0, tz), '2019-12-31 22:00');
  const old = parseTimeUnits('days since 0001-01-01');
  assert.equal(decodeTime(0, old, 'proleptic_gregorian'), '0001-01-01');
});

test('normCalendar and cfSummary', () => {
  assert.equal(normCalendar('Gregorian'), 'standard');
  assert.equal(normCalendar('365_day'), 'noleap');
  assert.equal(normCalendar(undefined), 'standard');
  const s = cfSummary({ units: 'days since 2000-01-01', calendar: 'noleap', long_name: 'time', foo: 1 });
  assert.deepEqual(s.time, { unit: 'days', calendar: 'noleap' });
  assert.equal(s.foo, undefined);
});
