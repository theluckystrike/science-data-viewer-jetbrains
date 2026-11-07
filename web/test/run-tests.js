'use strict';
// Runs the NetCDF and NumPy core tests from the VS Code extensions against the sources that go into the bundles.
// Setup writes the NumPy fixtures (each under 5 MB) with test/make-tensor-fixtures.py; teardown deletes them.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const fix = path.join(root, 'test', '.tmp-fixtures');
fs.rmSync(fix, { recursive: true, force: true });
let code = 1;
try {
  const py = spawnSync('python3', [path.join(__dirname, 'make-tensor-fixtures.py'), fix], { stdio: 'inherit' });
  if (py.status !== 0) throw new Error('fixture setup failed (needs numpy, safetensors and gguf)');
  for (const f of fs.readdirSync(fix)) if (fs.statSync(path.join(fix, f)).size > 5 * 1024 * 1024) throw new Error('fixture over 5 MB: ' + f);
  const files = [
    ...fs.readdirSync(path.join(__dirname, 'netcdf')).filter(f => f.endsWith('.test.mjs')).map(f => path.join('test', 'netcdf', f)),
    ...fs.readdirSync(path.join(__dirname, 'tensor')).filter(f => f.endsWith('.test.js')).map(f => path.join('test', 'tensor', f)),
    path.join('test', 'bundle.test.js'),
  ];
  const r = spawnSync(process.execPath, ['--test', ...files], { cwd: root, stdio: 'inherit', env: { ...process.env, TENSOR_FIX: fix } });
  code = r.status;
} catch (e) {
  console.error(e.message);
} finally {
  fs.rmSync(fix, { recursive: true, force: true });
}
process.exit(code);
