'use strict';
// Checks the built bundles in src/main/resources/web: present, self-contained, and free of Node-only imports.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const web = path.join(__dirname, '..', '..', 'src', 'main', 'resources', 'web');

test('every bundle and the page template exist', () => {
  for (const f of ['netcdf.js', 'netcdf-worker.js', 'tensor.js', 'netcdf.css', 'tensor.css', 'shell.css', 'view.html']) assert.ok(fs.statSync(path.join(web, f)).size > 0, f);
});

test('bundles make no network calls and load nothing from outside the private origin', () => {
  for (const f of ['netcdf.js', 'netcdf-worker.js', 'tensor.js']) {
    const s = fs.readFileSync(path.join(web, f), 'latin1');
    assert.ok(!/require\(["'](fs|path|worker_threads|child_process)["']\)/.test(s), f + ' has a Node import');
    assert.ok(!/https?:\/\/(?!www\.w3\.org)[a-z0-9.-]+\.(com|org|io|net)\/[^"'\s]*\.(js|wasm)/i.test(s), f + ' loads remote code');
  }
});

test('the page template has a strict CSP and every placeholder', () => {
  const t = fs.readFileSync(path.join(web, 'view.html'), 'utf8');
  assert.match(t, /default-src 'none'/);
  assert.match(t, /connect-src 'self'/);
  for (const k of ['NONCE', 'TOKEN', 'KIND', 'TITLE', 'BODYCLASS', 'FOOTER', 'CONFIG']) assert.ok(t.includes('{{' + k + '}}'), k);
});
