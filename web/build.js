'use strict';
// Builds the browser bundles into ../src/main/resources/web (committed, so the Gradle build needs no Node).
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const root = __dirname;
const out = path.join(root, '..', 'src', 'main', 'resources', 'web');
fs.mkdirSync(out, { recursive: true });
const shims = path.join(root, 'src', 'shared');
const common = {
  bundle: true, minify: true, sourcemap: false, legalComments: 'none', logLevel: 'warning', absWorkingDir: root,
  platform: 'browser', target: 'chrome120',
  inject: [path.join(shims, 'buffer-global.js')],
  alias: { '@huggingface/gguf': path.join(shims, 'gguf-stub.js'), fs: path.join(shims, 'fs-shim.js'), 'node:fs': path.join(shims, 'fs-shim.js') },
};
Promise.all([
  esbuild.build({ ...common, entryPoints: ['src/netcdf/page.js'], outfile: path.join(out, 'netcdf.js'), format: 'iife' }),
  esbuild.build({ ...common, entryPoints: ['src/netcdf/worker-browser.js'], outfile: path.join(out, 'netcdf-worker.js'), format: 'iife' }),
  esbuild.build({ ...common, entryPoints: ['src/tensor/page.js'], outfile: path.join(out, 'tensor.js'), format: 'iife' }),
]).then(() => {
  fs.copyFileSync(path.join(root, 'src/netcdf/webview.css'), path.join(out, 'netcdf.css'));
  fs.copyFileSync(path.join(root, 'src/tensor/webview.css'), path.join(out, 'tensor.css'));
  for (const f of fs.readdirSync(out)) console.log(f.padEnd(22), fs.statSync(path.join(out, f)).size);
}, e => { console.error(e && e.message); process.exit(1); });
