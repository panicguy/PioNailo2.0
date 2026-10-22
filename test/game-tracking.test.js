'use strict';
// Local responses only: no game account, network request or real Meta Pixel.
const assert = require('node:assert/strict');
const { app, BrowserWindow, session } = require('electron');
const { blockMetaPixel } = require('../src/main/guest-runtime');
app.commandLine.appendSwitch('log-level', '3');
app.on('window-all-closed', () => {}); // Compare two independent hidden sessions.
const page = `<!doctype html><meta charset="utf-8"><script src="https://connect.facebook.net/en_US/fbevents.js"></script><script src="/app.js"></script><main>Jogo fictício</main>`;
const csp = "default-src 'none'; script-src 'self' https://connect.facebook.net; frame-src 'none'";
const pixel = "window.pixelExecuted=true;const f=document.createElement('iframe');f.src='https://www.facebook.com/tr/';document.body.appendChild(f)";

async function check(filter) {
  const ses = session.fromPartition('tracking-test-' + filter, {cache: false});
  let pixelRequests = 0;
  ses.protocol.handle('https', request => {
    const url = new URL(request.url);
    if (url.hostname === 'connect.facebook.net') {
      pixelRequests++;
      // Defer until a body exists, just like the asynchronously loaded pixel.
      return new Response("addEventListener('DOMContentLoaded',()=>{" + pixel + "})", {headers: {'content-type': 'text/javascript'}});
    }
    if (url.hostname === 'pokeidle.io' && url.pathname === '/app') return new Response(page, {headers: {'content-type': 'text/html', 'content-security-policy': csp}});
    if (url.hostname === 'pokeidle.io' && url.pathname === '/app.js') return new Response('window.gameExecuted=true', {headers: {'content-type': 'text/javascript'}});
    return new Response('', {status: 404});
  });
  if (filter) blockMetaPixel(ses);
  const win = new BrowserWindow({show: false, webPreferences: {session: ses, sandbox: true}});
  const failedFrames = [];
  win.webContents.on('did-fail-load', (_event, _code, description, url, main) => { if (!main) failedFrames.push({description, url}); });
  await win.loadURL('https://pokeidle.io/app');
  await new Promise(resolve => setTimeout(resolve, 100));
  const state = await win.webContents.executeJavaScript('({game:!!window.gameExecuted,pixel:!!window.pixelExecuted})');
  assert.equal(state.game, true, 'game script still runs');
  assert.equal(state.pixel, !filter);
  assert.equal(pixelRequests, filter ? 0 : 1, 'the pixel is canceled before fetching/executing');
  if (filter) assert.equal(failedFrames.length, 0, 'no failed Facebook tracking frame');
  else assert.ok(failedFrames.some(frame => frame.url === 'https://www.facebook.com/tr/' && frame.description === 'ERR_BLOCKED_BY_CSP'), 'baseline reproduces the reported warning');
  await win.webContents.executeJavaScript("const probe=document.createElement('iframe');probe.src='https://blocked.test/';document.body.appendChild(probe)");
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.ok(failedFrames.some(frame => frame.url === 'https://blocked.test/' && frame.description === 'ERR_BLOCKED_BY_CSP'), 'CSP still blocks forbidden frames');
  win.destroy();
  ses.protocol.unhandle('https');
}

app.whenReady().then(async () => {
  await check(false); await check(true);
  console.log('PASS: reproduces Meta tracking CSP failure, removes the pixel bootstrap and preserves game scripts/CSP.');
  app.exit(0);
}).catch(error => { console.error(error.stack); app.exit(1); });
setTimeout(() => { console.error('Tracking test timed out'); app.exit(1); }, 15000);
