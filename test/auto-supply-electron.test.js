'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, session } = require('electron');
const root = path.resolve(__dirname, '..');
const profile = path.join(root, 'scratch', 'supply-integration-' + Date.now());
fs.mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.commandLine.appendSwitch('log-level', '3');
const logs = [];
ipcMain.on('app:version', e => { e.returnValue = 'test'; });
ipcMain.handle('creds:load', () => Array.from({ length: 4 }, (_, i) => ({ name: 'Conta ' + (i + 1), email: 'test' + i, senha: 'test' })));
ipcMain.handle('twitch:creds:load', () => []);
ipcMain.handle('twitch:status:get', () => []);
ipcMain.handle('errlog:write', (_e, origin, msg) => logs.push({ origin, msg }));
for (const name of ['creds:save', 'awake:set', 'mintray:set', 'notify', 'backup:save', 'proxy:apply', 'auth:cancel-login']) ipcMain.handle(name, () => true);
ipcMain.handle('autostart:get', () => ({ on: false, suportado: false }));
ipcMain.handle('window:control', () => ({ maximized: false }));
ipcMain.handle('auth:camoufox-check', () => ({ available: false }));
ipcMain.handle('auth:camoufox-login', () => ({ success: false }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture = pathToFileURL(path.join(__dirname, 'fixtures', 'panel.html')).href;
app.whenReady().then(async () => {
  const deny = ses => ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  deny(session.defaultSession);
  for (let i = 1; i <= 4; i++) deny(session.fromPartition('persist:conta' + i));
  const win = new BrowserWindow({ show: false, webPreferences: { webviewTag: true, preload: path.join(root, 'preload.js'), backgroundThrottling: false } });
  win.webContents.on('will-attach-webview', (_e, _p, params) => { params.src = fixture; });
  const read = code => win.webContents.executeJavaScript(code);
  const guest = (i, code) => read(`webviews[${i}].executeJavaScript(${JSON.stringify(code)})`);
  await win.loadFile(path.join(root, 'index.html'));
  let ready = false;
  for (let i = 0; i < 80; i++) {
    if (await read(`webviews.length===4 && webviews.every(w=>{try{return w.getURL()===${JSON.stringify(fixture)}&&!w.isLoading()}catch{return false}})`)) { ready = true; break; }
    await pause(100);
  }
  assert.ok(ready, 'four isolated guests loaded');
  for (let i = 0; i < 4; i++) await guest(i, `(() => {
    const eu = { id:'test-${i}', nick:'Conta ${i + 1}', gold:200000, level:100, balls:{3:900}, items:{201:333}, pokemons:[] };
    const sock = new EventTarget(); sock.readyState=1;
    window.__supplyOrders=[];
    const P=window.__poke;
    P.estado=eu;P.gold=eu.gold;P.cid=eu.id;P.nick=eu.nick;
    P.api['/api/characters/me']={character:{id:eu.id,name:eu.nick,gold:eu.gold,level:eu.level}};
    P.ws.balls={counts:eu.balls,catalog:[{id:3,name:'Super Ball',priceGold:50},{id:4,name:'Ultra Ball',priceGold:130}]};
    P.ws.inventory={items:[{itemId:201,quantity:333}]};
    window.estado={eu,ws:sock};P.sock=sock;
    sock.send=data=>{
      const o=JSON.parse(data);if(o.t!=='shop.buy')return;
      window.__supplyOrders.push(o);
      const field=o.kind==='ball'?'balls':'items';
      eu[field][o.id]=(+eu[field][o.id]||0)+o.qty;
      P.ws.inventory={items:Object.entries(eu.items).map(([itemId,quantity])=>({itemId:+itemId,quantity}))};
      setTimeout(()=>sock.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({t:'estado',estado:{[field]:{[o.id]:eu[field][o.id]}}})})),10);
    };
  })()`);
  await read(`saveAutoSupplyCfg({enabled:true,buyPartial:true,selectedAccounts:[0,1,2,3],defaultCfg:{balls:{enabled:true,selectedId:4,min:39,target:1000},potions:{enabled:true,selectedId:200,min:5,target:100},revives:{enabled:false,selectedId:205,min:10,target:50}},accountCfgs:{1:{custom:true,balls:{enabled:true,selectedId:3,min:150,target:1000}}}});openAutoSupplyModal()`);
  assert.equal(await read('document.querySelector("#supplyBallsSelect").value'), '4');
  const before = await read('readPanelState(0)');
  assert.equal(before.ballMap[4], undefined, 'collector omits the exhausted ball');
  assert.equal(before.balls, 900, 'other ball has stock and must not mask the exhausted Ultra Ball');
  await read('executeAutoSupply(false)');
  for (let i = 0; i < 4; i++) assert.deepEqual(await guest(i, 'window.__supplyOrders'), [
    { t: 'shop.buy', kind: 'ball', id: 4, qty: 1000 },
    { t: 'shop.buy', kind: 'item', id: 200, qty: 100 }
  ]);
  assert.ok(await read('document.querySelector("#autoSupplyStatusText").textContent.includes("✅")'));
  await read('executeAutoSupply(false)');
  for (let i = 0; i < 4; i++) assert.equal(await guest(i, 'window.__supplyOrders.length'), 2);
  assert.equal(await read('autoSupplyExecuting'), false);
  await read('openAutoSupplyModal()');
  assert.equal(await read('document.getElementById("supplyEditingTitle").textContent'),'Editando 4 contas');
  await read(`document.querySelector('[data-supply-edit="1"]').click()`);
  assert.deepEqual(await read('autoSupplyDraft.selectedAccounts'),[1]);
  assert.equal(await read('document.getElementById("supplyBallsSelect").disabled'),false);
  await read('document.getElementById("supplyBallsSelect").value="3";document.getElementById("supplyBallsMin").value="950";document.getElementById("supplyBallsTarget").value="1200";document.getElementById("supplyPotionsEnable").checked=false;commitCurrentScopeInputs(true);document.getElementById("autoSupplySelectAll").click()');
  assert.equal(await read('document.getElementById("supplyEditingTitle").textContent'),'Editando 4 contas');
  assert.equal(await read('document.getElementById("supplyBallsSelect").value'),'','different items are shown as mixed');
  assert.equal(await read('document.getElementById("supplyPotionsEnable").indeterminate'),true);
  await read('commitCurrentScopeInputs(true)');
  assert.equal(await read('getEffectiveSupplyConfig(autoSupplyDraft,0).balls.selectedId'),4,'untouched mixed value retained');
  assert.equal(await read('getEffectiveSupplyConfig(autoSupplyDraft,1).balls.selectedId'),3);
  await read('document.getElementById("supplyBallsSelect").value="3";document.getElementById("supplyBallsMin").value="950";document.getElementById("supplyBallsTarget").value="1200";commitCurrentScopeInputs(true)');
  for(let i=0;i<4;i++) assert.equal(await read(`getEffectiveSupplyConfig(autoSupplyDraft,${i}).balls.target`),1200,'batch edit includes prior individual rule');
  assert.equal(await read('getEffectiveSupplyConfig(autoSupplyDraft,0).potions.enabled'),true,'untouched mixed checkbox retained');
  assert.equal(await read('getEffectiveSupplyConfig(autoSupplyDraft,1).potions.enabled'),false);
  await read('document.getElementById("supplyBallsTarget").value="1300";commitCurrentScopeInputs();document.getElementById("supplyBallsTarget").value="1200";commitCurrentScopeInputs(true)');
  assert.equal(await read('getEffectiveSupplyConfig(autoSupplyDraft,0).balls.target'),1200,'reverting a typed value is applied');
  for (const theme of ['absol-night','pkmn-gengar','creme-vanilla']) {
    await read(`window.PIWThemeManager.selectTheme(${JSON.stringify(theme)})`);
    for (const [width,height] of [[1920,1032],[1600,950],[820,720]]) {
      win.setContentSize(width,height);await pause(120);
      fs.writeFileSync(path.join(profile,theme+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG());
    }
  }
  await read('saveAutoSupplyCfg(autoSupplyDraft);closeAutoSupplyModal();openAutoSupplyModal()');
  assert.equal(await read('document.getElementById("supplyBallsTarget").value'),'1200');
  await read('executeAutoSupply(false)');
  for(let i=0;i<4;i++) assert.deepEqual((await guest(i,'window.__supplyOrders')).slice(2),[{t:'shop.buy',kind:'ball',id:3,qty:300}]);
  await read(`document.querySelector('[data-supply-edit="1"]').click();document.getElementById('supplyBallsTarget').value='1500';commitCurrentScopeInputs(true)`);
  assert.equal(await read('getEffectiveSupplyConfig(autoSupplyDraft,1).balls.target'),1500);
  assert.equal(await read('getEffectiveSupplyConfig(autoSupplyDraft,0).balls.target'),1200,'single edit excludes other accounts');
  await read('closeAutoSupplyModal();openAutoSupplyModal()');
  assert.equal(await read('getEffectiveSupplyConfig(autoSupplyDraft,1).balls.target'),1200,'cancel discards edits');
  await read('document.getElementById("autoSupplyDeselectAll").click()');
  assert.equal(await read('document.getElementById("supplyBallsSelect").disabled'),true);
  assert.equal(await read('document.getElementById("autoSupplyBuyNow").disabled'),true);
  console.log('Batch and single editing, mixed values, save/cancel, effective purchases: PASS. Captures: '+profile);
  console.log('PASS: real launcher, collector, modal rules, four webviews, WebSocket inventory confirmations and no duplicate restock. Isolated profile; no real account or network access.');
  app.exit(0);
}).catch(e => { console.error(e.stack); console.error(JSON.stringify(logs)); app.exit(1); });
setTimeout(() => { console.error('Auto Supply integration timed out'); app.exit(1); }, 30000);
