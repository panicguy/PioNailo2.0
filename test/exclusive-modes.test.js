const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
for (const saved of [{eco:'1',cleanHud:'0'}, {eco:'0',cleanHud:'1'}, {eco:'1',cleanHud:'1'}]) {
  const calls = [], buttons = {};
  const storage = {...saved};
  const context = vm.createContext({
    document: {getElementById: id => buttons[id] ||= {classList:{toggle(){}}}},
    lsGet: key => storage[key], lsSet: (key,value) => storage[key]=value,
    t: key => key, off: [false], grid: {children: []},
    webviews: [{executeJavaScript: code => {calls.push(code); return Promise.resolve();}}]
  });
  const ecoStart = html.indexOf("    const ecoBtn =");
  const ecoEnd = html.indexOf('    // ----- Foco por Família', ecoStart);
  const cleanStart = html.indexOf('    const cleanScript =');
  const cleanEnd = html.indexOf('  // New layouts', cleanStart);
  vm.runInContext(html.slice(ecoStart,ecoEnd) + html.slice(cleanStart,cleanEnd),context);
  vm.runInContext('applyEco(); applyClean();',context);
  assert.notEqual(storage.eco + storage.cleanHud, '11', 'startup resolves conflicting saved modes');
  if(saved.cleanHud === '1') assert.equal(storage.cleanHud,'1');
  for (const id of ['eco','cleanHud','eco','cleanHud','cleanHud','eco','eco']) {
    calls.length=0;
    const wasOn = storage[id] === '1';
    const otherWasOn = storage[id === 'eco' ? 'cleanHud' : 'eco'] === '1';
    buttons[id].onclick();
    assert.equal(storage[id],wasOn?'0':'1');
    assert.notEqual(storage.eco + storage.cleanHud,'11');
    if(!wasOn) {
      if(id==='cleanHud') {
        const exit = calls.findIndex(code => code.includes('const ligar = false'));
        const enter = calls.findIndex(code => code.includes('if (!true)'));
        assert.ok(exit >= 0 && enter > exit,'leave economy before enabling hunt view');
      } else if (otherWasOn) {
        const exit = calls.findIndex(code => code.includes('if (!false)'));
        const enter = calls.findIndex(code => code.includes('const ligar = true'));
        assert.ok(exit >= 0 && enter > exit,'leave hunt view before enabling economy');
      }
    }
  }
}
for (const script of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
console.log('PASS: exclusive modes, saved state, guest command order and launcher syntax');
