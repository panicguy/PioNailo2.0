'use strict';

const guardedContents = new WeakSet();
const filteredSessions = new WeakSet();

// Electron 43 waits for did-stop-loading separately for every executeJavaScript
// call. Startup injects many independent scripts at dom-ready; share that wait
// instead, then hand every call back to Electron with its arguments unchanged.
function coalesceScriptLoading(contents) {
  if (guardedContents.has(contents)) return;
  guardedContents.add(contents);
  const execute = contents.executeJavaScript;
  let loading = null;

  function waitForLoad() {
    if (contents.isDestroyed()) return Promise.reject(new Error('Game panel was destroyed'));
    if (contents.getURL() && !contents.isLoadingMainFrame()) return Promise.resolve();
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const cleanup = () => {
        contents.removeListener('did-stop-loading', stopped);
        contents.removeListener('destroyed', destroyed);
        loading = null;
      };
      const stopped = () => { cleanup(); resolve(); };
      const destroyed = () => { cleanup(); reject(new Error('Game panel was destroyed')); };
      contents.once('did-stop-loading', stopped);
      contents.once('destroyed', destroyed);
    });
    return loading;
  }

  contents.executeJavaScript = async function (...args) {
    // A new navigation may start before an earlier wait's microtasks resume.
    // Recheck before calling Electron so it never builds another listener burst.
    do { await waitForLoad(); }
    while (!contents.isDestroyed() && contents.isLoadingMainFrame());
    if (contents.isDestroyed()) throw new Error('Game panel was destroyed');
    if (!contents.getURL()) throw new Error('Game panel did not load');
    return execute.apply(contents, args);
  };
}

function blockMetaPixel(gameSession) {
  if (filteredSessions.has(gameSession)) return;
  filteredSessions.add(gameSession);
  // Only the advertising bootstrap. Do not whitelist the Facebook tracking
  // frame in CSP or block Facebook login/navigation or other game resources.
  gameSession.webRequest.onBeforeRequest({ urls: ['https://connect.facebook.net/*/fbevents.js*'] }, (details, callback) => {
    let pixel = false;
    try {
      const url = new URL(details.url);
      pixel = details.resourceType === 'script' && url.hostname === 'connect.facebook.net' && /^\/[^/]+\/fbevents\.js$/.test(url.pathname);
    } catch {}
    callback({ cancel: pixel });
  });
}

module.exports = { coalesceScriptLoading, blockMetaPixel };
