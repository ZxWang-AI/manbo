// Test-only entry. Never distribute this file or expose inspector in releases.
const { app, BrowserWindow, safeStorage } = require('electron');
const { isAbsolute, resolve, join } = require('node:path');
const { realpathSync, lstatSync } = require('node:fs');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const root = process.argv.find((arg) => arg.startsWith('--native-test-root='))?.slice('--native-test-root='.length);
assert.ok(root && isAbsolute(root), 'An absolute synthetic test profile is required');
assert.ok(resolve(root).startsWith(join(realpathSync(tmpdir()), 'manbo-native-safety-')), 'Profile must be in the unique synthetic temp prefix');
assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
assert.equal(realpathSync(root), resolve(root));
app.setPath('userData', root);
assert.equal(app.getPath('userData'), root);
globalThis.__manboNativeTest = { app, BrowserWindow, safeStorage, root, require };
// Only this test entry redirects the main's gateway import. Real gateway, Pi,
// HTTPS transport and lifecycle run unchanged behind a synthetic TCP receiver.
const { registerHooks } = require('node:module');
const { pathToFileURL } = require('node:url');
registerHooks({resolve(specifier,context,nextResolve){
  if (specifier === '../agent/model-gateway.mjs'
    && context.parentURL === pathToFileURL(require.resolve('../main.cjs')).href) {
    return {url:pathToFileURL(join(__dirname,'native-model-gateway.mjs')).href,shortCircuit:true};
  }
  return nextResolve(specifier,context);
}});
require('../main.cjs');
