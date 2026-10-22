// Integration check in Electron with blank guests, fake accounts and an isolated profile.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain, session, webContents } = require('electron');
const { coalesceScriptLoading } = require('../src/main/guest-runtime');

const root = path.resolve(__dirname, '..');
const guestUrl = pathToFileURL(path.join(__dirname, 'fixtures', 'panel.html')).href;
const output = path.join(root, 'scratch', 'simple-theme-' + Date.now());
fs.mkdirSync(output, { recursive: true });
app.setPath('userData', path.join(output, 'profile'));
app.commandLine.appendSwitch('log-level', '3'); app.disableHardwareAcceleration();
const errors = [];
const listenerWarnings = [];
process.on('warning', warning => { if (warning.name === 'MaxListenersExceededWarning') listenerWarnings.push(warning); });
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') coalesceScriptLoading(contents);
});
const fakeAccounts = Array.from({ length: 4 }, (_, i) => ({ name: 'Conta ' + (i + 1), email: 'test' + i, senha: 'test' }));
ipcMain.on('app:version', event => { event.returnValue = 'test'; });
ipcMain.handle('creds:load', () => fakeAccounts);
ipcMain.handle('creds:save', () => true);
ipcMain.handle('twitch:creds:load', () => ({}));
ipcMain.handle('errlog:write', (_event, origin, message) => errors.push(origin + ': ' + message));
for (const name of ['awake:set', 'mintray:set', 'notify', 'backup:save', 'proxy:apply', 'auth:cancel-login']) ipcMain.handle(name, () => true);
ipcMain.handle('autostart:get', () => ({ on: false, suportado: false }));
ipcMain.handle('window:control', () => ({ maximized: false }));
ipcMain.handle('auth:camoufox-check', () => ({ available: false }));
ipcMain.handle('auth:camoufox-login', () => ({ success: false }));

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let win;
const read = code => win.webContents.executeJavaScript(code);
async function ready() {
  for (let i = 0; i < 80; i++) {
    if (await read('webviews.length === 4 && !!document.getElementById("leafShell") && webviews.every(w => { try { return w.getURL() === ' + JSON.stringify(guestUrl) + '; } catch { return false; } })')) return;
    await pause(100);
  }
  throw new Error('Launcher did not initialize: ' + errors.join('\n'));
}
app.whenReady().then(async () => {
 const deny=s=>s.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(_,cb)=>cb({cancel:true}));
 deny(session.defaultSession);for(let i=1;i<=4;i++)deny(session.fromPartition('persist:conta'+i));
 win=new BrowserWindow({width:1600,height:950,show:false,webPreferences:{offscreen:false,webviewTag:true,preload:path.join(root,'preload.js'),backgroundThrottling:false}});
 win.webContents.on('will-attach-webview',(_,p,params)=>{params.src=guestUrl});
 await win.loadFile(path.join(root,'index.html'));await ready();
 await read('document.getElementById("leafSimple").click()');
 await pause(100);

 await read("PIWThemeManager.selectTheme('pkmn-flareon'); lifeCatch = [{n:'Bulbasaur',sid:1,iv:151,ivs:{hp:32,atk:20,def:27,spAtk:24,spDef:32,speed:24},q:1.5,sh:false,potencia:3,nota:4.25,t:Date.now(),p:0,acc:'Conta 1',dot:'#3fb950'}]; refreshCards(true);");
 for(const [width,height] of [[1920,1032],[1600,950],[820,720]]) {
   win.setContentSize(width,height);await pause(200);
   const result=await read("(()=>{const p=document.querySelector('.cd-ivs-pills');return {text:p&&p.textContent,row:p&&p.closest('.cd-capture').textContent}})()");
   assert.ok(result.text,'capture attributes rendered');
   for(const text of ['HP: 32','ATK: 20','DEF: 27','SPATK: 24','SPDEF: 32','SPEED: 24'])assert.ok(result.text.includes(text),text);
   assert.ok(result.row.includes('Nota: 4.25'));assert.ok(result.row.includes('Potência: P3'));
   await read("document.querySelector('.cd-ivs-pills').scrollIntoView({block:'center'});");await pause(100);
   fs.writeFileSync(path.join(output,'attributes-'+width+'.png'),(await win.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
 }
 await read("lifeCatch = [{n:'High',q:4,potencia:5,nota:8},{n:'Mid',q:1.5,potencia:3,nota:4.25},{n:'Low',q:1,potencia:1,nota:1},{n:'Unknown',q:1,potencia:null,nota:null}].map((x,i)=>({...x,t:Date.now()+i,p:0,acc:'Conta 1',dot:'#3fb950',iv:150})); cdFC = {p:-1,n:'',sh:0,q:0,potencia:0,nota:0,iv:0,per:0,stat:'',statV:0}; refreshCards(true);");await pause(200);
 const names=()=>read("Array.from(document.querySelectorAll('.cd-capture .rn')).map(e=>e.textContent)");
 const setFilter=async(id,value)=>{await read("(()=>{const e=document.getElementById("+JSON.stringify(id)+");e.value="+JSON.stringify(value)+";e.dispatchEvent(new Event('change'));})()");await pause(200);};
 assert.equal((await names()).length,4);
 await setFilter('cdFcQ','3');assert.equal((await names()).length,1);
 await setFilter('cdFcQ','');await setFilter('cdFcPot','3');assert.equal((await names()).length,2);
 await setFilter('cdFcNota','5');assert.equal((await names()).length,1);
 const saved=await read("JSON.parse(lsGet('cdFC'))");assert.equal(saved.potencia,3);assert.equal(saved.nota,5);
 await setFilter('cdFcPot','0');await setFilter('cdFcNota','');assert.equal((await names()).length,4);
 console.log('PASS capture filters quality, potency, note, combination, persistence; capture labels, note, potency; screenshots: '+output);win.destroy();app.exit(0);
}).catch(e=>{console.error(e);app.exit(1)});

