'use strict';
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { coalesceScriptLoading, blockMetaPixel } = require('../src/main/guest-runtime');

function fakeContents() {
  const wc = new EventEmitter();
  wc.loading = true; wc.url = 'https://pokeidle.io/app'; wc.destroyed = false;
  wc.isDestroyed = () => wc.destroyed;
  wc.getURL = () => wc.url;
  wc.isLoadingMainFrame = () => wc.loading;
  wc.calls = [];
  wc.executeJavaScript = function (...args) {
    assert.equal(this, wc); assert.equal(wc.loading, false);
    wc.calls.push(args);
    if (args[0] === 'throw') return Promise.reject(new Error('Script error'));
    return Promise.resolve(args[0]);
  };
  coalesceScriptLoading(wc);
  coalesceScriptLoading(wc); // idempotent when reattached
  return wc;
}

(async () => {
  const wc = fakeContents();
  const tasks = Array.from({length: 40}, (_, i) => wc.executeJavaScript(i, i === 2));
  assert.equal(wc.listenerCount('did-stop-loading'), 1);
  assert.equal(wc.listenerCount('destroyed'), 1);
  wc.loading = false; wc.emit('did-stop-loading');
  assert.deepEqual(await Promise.all(tasks), Array.from({length: 40}, (_, i) => i));
  assert.deepEqual(wc.calls[2], [2, true], 'user gesture and code are preserved');
  assert.equal(wc.listenerCount('did-stop-loading'), 0);
  assert.equal(wc.listenerCount('destroyed'), 0);
  await assert.rejects(wc.executeJavaScript('throw'), /Script error/);
  assert.equal(await wc.executeJavaScript('next'), 'next', 'a failing script does not stop other calls');

  wc.loading = true;
  const racing = Array.from({length: 40}, (_, i) => wc.executeJavaScript(i));
  wc.loading = false; wc.emit('did-stop-loading'); wc.loading = true;
  await Promise.resolve();
  assert.equal(wc.listenerCount('did-stop-loading'), 1, 'a navigation race still shares one wait');
  wc.loading = false; wc.emit('did-stop-loading');
  await Promise.all(racing);

  const closing = fakeContents();
  const rejected = Promise.allSettled(Array.from({length: 40}, () => closing.executeJavaScript('pending')));
  closing.destroyed = true; closing.emit('destroyed');
  assert.ok((await rejected).every(result => result.status === 'rejected'));
  assert.equal(closing.listenerCount('did-stop-loading'), 0, 'closing releases pending load listeners');
  assert.equal(closing.listenerCount('destroyed'), 0);
  const failed = fakeContents(); failed.url = '';
  const missing = assert.rejects(failed.executeJavaScript('pending'), /did not load/);
  failed.loading = false; failed.emit('did-stop-loading'); await missing;

  let handler, installations = 0;
  const ses = { webRequest: { onBeforeRequest(_filter, fn) { handler = fn; installations++; } } };
  blockMetaPixel(ses); blockMetaPixel(ses);
  assert.equal(installations, 1, 'four accounts sharing a session do not reinstall the filter');
  function blocked(url, resourceType = 'script') {
    let result; handler({url, resourceType}, response => { result = response.cancel; }); return result;
  }
  assert.equal(blocked('https://connect.facebook.net/en_US/fbevents.js'), true);
  assert.equal(blocked('https://connect.facebook.net/pt_BR/fbevents.js?v=1'), true);
  for (const url of ['https://pokeidle.io/app.js', 'https://challenges.cloudflare.com/turnstile/v0/api.js', 'https://www.facebook.com/login', 'https://connect.facebook.net/en_US/sdk.js', 'https://connect.facebook.net.evil.test/en_US/fbevents.js', 'invalid']) assert.equal(blocked(url), false, url);
  assert.equal(blocked('https://connect.facebook.net/en_US/fbevents.js', 'mainFrame'), false);
  console.log('PASS: shared loading, navigation races, destruction, script errors and precise Meta Pixel filtering.');
})().catch(error => { console.error(error); process.exitCode = 1; });
