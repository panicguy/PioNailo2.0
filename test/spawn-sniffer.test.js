const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../tools/tampermonkey_spawn_sniffer.user.js'), 'utf8');
function fixture() {
  let now = 1000;
  const elements = {}, saved = {}, sent = [];
  const ids = ['sniff-badge','sniff-progress','sniff-speed','sniff-curr','sniff-combat','btn-sniff-toggle','btn-sniff-skip','btn-sniff-download','btn-sniff-logs'];
  class Socket {
    static OPEN = 1;
    constructor() { this.readyState = 1; this.listeners = {}; }
    addEventListener(t, fn) { this.listeners[t] = fn; }
    send(data) { sent.push(JSON.parse(data)); }
    receive(m) { this.listeners.message({data: JSON.stringify(m)}); }
  }
  const window = {WebSocket: Socket};
  const document = {
    readyState: 'complete',
    getElementById: id => elements[id] || null,
    createElement: () => ({style: {}, click() {}}),
    body: {appendChild(el) { elements[el.id] = el; for (const id of ids) elements[id] = {style: {}}; }}
  };
  let tick;
  let exported;
  class FakeBlob { constructor(parts) { exported = JSON.parse(parts[0]); } }
  vm.runInNewContext(source, {window, document, localStorage: {getItem: () => null, setItem: (k,v) => saved[k] = JSON.parse(v)}, Date: {now: () => now}, console: {warn() {}, info() {}}, alert() {}, setInterval: fn => tick = fn, Blob: FakeBlob, URL: {createObjectURL: () => 'blob:test', revokeObjectURL() {}}, setTimeout: fn => fn()});
  const socket = new window.WebSocket();
  socket.receive({t:'welcome', estado:{level:10}, hunts:[{slug:'a',nivel:1},{slug:'b',nivel:2}]});
  return {socket, elements, saved, sent, exportDump() { elements['btn-sniff-download'].onclick(); return exported; }, exportLogs() { elements['btn-sniff-logs'].onclick(); return exported; }, start: () => elements['btn-sniff-toggle'].onclick(), advance(ms) {now += ms; tick();}, window};
}
const mobs = Array.from({length:15}, (_,c) => ({c,r:0,s:1}));
{
  const f = fixture(); f.start();
  f.socket.receive({t:'campo', mobs});
  f.socket.receive({t:'campo.init', slug:'wrong', box:[0,0]});
  f.socket.receive({t:'campo', mobs});
  assert.deepEqual(f.saved, {}, 'unconfirmed route cannot save mobs');
  f.socket.receive({t:'campo.init', slug:'a', box:[10,20]});
  f.socket.receive({t:'campo', mobs});
  assert.equal(f.saved.pokeidle_spawns_dump_v3.a.mobs.length,15);
  assert.equal(f.sent.at(-1).slug,'b');
  f.socket.receive({t:'campo', mobs});
  assert.equal(f.saved.pokeidle_spawns_dump_v3.b,undefined,'late mobs do not contaminate next hunt');
  f.socket.receive({t:'campo.init', slug:'b', box:[30,40]});
  f.socket.receive({t:'campo', slug:'a', mobs});
  assert.equal(f.saved.pokeidle_spawns_dump_v3.b,undefined);
  f.socket.receive({t:'campo', mobs});
  assert.equal(f.saved.pokeidle_spawns_dump_v3.b.mobs[0].globalX,30);
  assert.equal(f.window.WebSocket.OPEN,1);
}
{
  const f = fixture(); f.start();
  for(let i=0;i<4;i++) f.advance(8000);
  assert.equal(f.sent.filter(x => x.slug === 'a').length,3,'retry count bounded');
  assert.equal(f.sent.at(-1).slug,'b');
}
{
  const f = fixture(); f.socket.readyState = 3; f.start();
  assert.equal(f.sent.length,0);
  assert.match(f.elements['sniff-combat'].innerText,/desconectado/);
}
{
  const f = fixture(); f.start();
  f.socket.receive({t:'erro',chave:'hunt',msg:'rejeitada'});
  f.elements['ir-centro'] = {disabled:false};
  f.advance(100);
  assert.equal(f.sent.length,1,'enabled button cannot bypass retry delay');
  f.advance(3200);
  assert.equal(f.sent.length,2);
}
{
  const f = fixture(); f.start();
  f.socket.receive({t:'erro',chave:'hunt'});
  f.elements['ir-centro'] = {disabled:true};
  f.advance(31000);
  assert.match(f.elements['sniff-combat'].innerText,/30s/);
  assert.equal(f.sent.length,1);
}
console.log('Spawn sniffer checks passed: route confirmation, stale packets, retry limit, disconnect, cooldown and blocked button.');

{
  const f = fixture(); f.start();
  f.socket.receive({t:'welcome', token:'SECRET', estado:{token:'SECRET', huntSlug:'a'},hunts:[]});
  for(let i=0;i<3;i++) f.advance(8000);
  const report = f.exportLogs();
  assert.equal(report.versao,'3.0');
  assert.ok(report.logs.some(e => e.evento === 'ws.send'));
  assert.ok(report.logs.some(e => e.evento === 'hunt.timeout'));
  assert.ok(report.logs.some(e => e.evento === 'hunt.failed'));
  assert.equal(JSON.stringify(report).includes('SECRET'),false);
  for(let i=0;i<1600;i++) f.socket.receive({t:'estado', estado:{huntSlug:'a'}});
  assert.equal(f.exportLogs().logs.length,1500);
  console.log('Diagnostic export checks passed: failure evidence, credential exclusion, bounded log.');
}

{
 const f=fixture(); f.start();
 f.socket.receive({t:'campo.init',slug:'a',box:[10,20,53,34]});
 f.socket.receive({t:'campo',mobs:mobs.map(m=>({...m,speciesId:25,look:99,token:'SECRET'}))});
 const dump=f.exportDump();
 assert.equal(dump.schemaVersion,3);
 assert.equal(dump.catalogoHunts.length,2);
 assert.equal(dump.rotas.a.status,'amostra');
 assert.equal(dump.rotas.a.mobs[0].speciesId,25);
 assert.equal(dump.rotas.a.mobs[0].look,99);
 assert.equal(dump.cobertura[1].status,'pendente');
 assert.equal(JSON.stringify(dump.rotas).includes('SECRET'),false);
 console.log('Full export checks passed: catalog, species fields, coverage and sanitization.');
}
