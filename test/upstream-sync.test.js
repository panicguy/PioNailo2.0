// Exercise the actual injected reader and shell with offline, synthetic game state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('../src/ui/runtime-performance');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const shell = fs.readFileSync(path.join(__dirname, '..', 'src/ui/pokeleaf-shell.js'), 'utf8');

function injectedLiteral(marker, ending, pos = html.indexOf(marker)) {
  assert.ok(pos >= 0, 'injected source exists: ' + marker);
  const start = html.indexOf('`', pos), end = html.indexOf(ending, start + 1);
  assert.ok(end > start, 'injected literal has an ending');
  return vm.runInNewContext(html.slice(start, end + 1));
}
const collectorComment = html.indexOf('// coletor de estado + sessao dual-protocol');
assert.ok(collectorComment >= 0, 'collector injection is labeled');
const collectorStart = html.lastIndexOf('wv.executeJavaScript(`', collectorComment);
const collector = injectedLiteral('wv.executeJavaScript(`', '`).catch', collectorStart);
new vm.Script(collector); // The original collector failed here with Unexpected token catch.
const reader = injectedLiteral('  const READ_STATE =', '`;');
new vm.Script(reader);

const state = {
  cid: 'trainer-fixture', nick: 'Conta fictícia', level: 113, gold: 500,
  automation: { ballIds: [4] }, sock: { readyState: 1 },
  api: { '/game/items.json': { items: [
    { id: 10, name: 'Poção', category: 'potion' },
    { id: 11, name: 'Revive', category: 'revive' },
    { id: 20, name: 'Loot', category: 'loot', npcPrice: 5 }
  ] } },
  ws: {
    balls: { counts: { 1: 100, 4: 25, 900: 1 }, catalog: [
      { id: 1, name: 'Poké Ball' }, { id: 4, name: 'Ultra Ball' },
      { id: 900, name: 'Bola infinita', infinite: true }
    ] },
    inventory: { items: [{ itemId: 10, quantity: 14 }, { itemId: 11, quantity: 5 }] },
    pokes: { list: [{ id: 'pokemon-fixture', name: 'Venusaur', level: 113, team: true, leader: true, hp: 82, maxHp: 100 }] },
    'field-init': { slug: 'pupitar' }
  },
  sess: { start: Date.now() - 60000, kills: 10, xp: 100, captures: 3,
    drops: { 20: { qty: 4, name: 'Loot' } }, sellG: 10, supGold: 2 }
};
const emptyDocument = () => ({ getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  documentElement: { classList: { contains: () => false } } });
const guest = vm.createContext({ window: { __poke: state }, document: emptyDocument() });
let result = vm.runInContext(reader, guest);
assert.equal(result.live, true, 'socket state identifies a connected account without the character HTTP response');
assert.equal(result.cid, 'trainer-fixture'); assert.equal(result.name, 'Conta fictícia');
assert.equal(result.level, 113); assert.equal(result.gold, 500);
assert.equal(result.hunt, 'Pupitar'); assert.equal(result.team[0].name, 'Venusaur');
assert.equal(result.team[0].hp, 82); assert.equal(result.team[0].hm, 100);
assert.equal(result.balls, 25, 'supplies show the selected ball rather than all ball types combined');
assert.equal(result.equippedBall.name, 'Ultra Ball'); assert.equal(result.equippedBall.infinite, false);
assert.equal(result.potions, 14); assert.equal(result.revives, 5);
assert.equal(result.a.balance, 28); assert.ok(result.a.xph > 0);
state.ws.pokes.list.push({ id: 'active-fixture', name: 'Pikachu', level: 90, team: true, hp: 50, maxHp: 80 });
state.activeId = 'active-fixture';
result = vm.runInContext(reader, guest);
assert.equal(result.activeId, 'active-fixture');
assert.equal(result.team.find(pokemon => pokemon.ld).name, 'Pikachu', 'the active Pokémon is selected independently of team order');
state.automation.ballIds = [900];
result = vm.runInContext(reader, guest);
assert.equal(result.equippedBall.infinite, true); assert.equal(result.balls, 999999);
state.api['/game/items.json'].items.find(item => item.id === 10).npcPrice = 50;
state.api['/game/items.json'].items.find(item => item.id === 11).npcPrice = 150;
guest.localStorage = { getItem: key => key === 'sessao-hunt:conta fictícia' ? JSON.stringify({
  abates: 12, xpTreinador: 3600, capturas: 2, gold: 1000, ms: 3600000,
  bolas: { 4: 2 }, pocoes: { 10: 1 }, revives: { 11: 1 }, shiniesVistos: 1, shinies: 1
}) : null };
result = vm.runInContext(reader, guest);
assert.equal(result.a.srv, 1, 'the native game session is read without a swallowed initialization error');
assert.equal(result.a.kills, 12); assert.equal(result.a.captures, 2);
assert.equal(result.a.supplyGold, 460); assert.equal(result.a.balance, 550);
assert.equal(result.a.xph, 3600); assert.equal(result.a.kph, 12);
guest.localStorage.getItem = () => null;
const scoreboard = { querySelector: () => ({ textContent: '1h 00m' }) };
const metrics = {
  '[data-kpi="lucro"] .eco-kpi-v': '1.234,50', '[data-kpi="lucro"] .eco-kpi-h': '1.234,50/h',
  '[data-kpi="lucro"] .eco-kpi-sub': 'Gastos -120,50',
  '[data-kpi="xpTreinador"] .eco-kpi-v': '12.345', '[data-kpi="xpTreinador"] .eco-kpi-h': '12.345/h',
  '[data-kpi="abates"] .eco-kpi-v': '12', '[data-kpi="abates"] .eco-kpi-h': '1.200/h',
  '[data-kpi="capturas"] .eco-kpi-v': '2', '[data-kpi="capturas"] .eco-kpi-h': '2/h'
};
guest.document = {
  ...emptyDocument(),
  getElementById: id => id === 'eco-placar' ? scoreboard : null,
  querySelector: selector => selector in metrics ? { textContent: metrics[selector] } : null
};
result = vm.runInContext(reader, guest);
assert.equal(result.a.balance, 1244.5, 'the injected parser preserves thousands separators and decimal commas');
assert.equal(result.a.supplyGold, 120.5); assert.equal(result.a.gph, 1245);
assert.equal(result.a.xpg, 12345); assert.equal(result.a.xph, 12345); assert.equal(result.a.kph, 1200);
assert.equal(result.a.capturesGold, 10, 'capture value has its own panel line');
assert.equal(result.a.lootGold, 1355, 'capture value is not also classified as kill income');
guest.document = emptyDocument();
state.ws.analyzer = { seconds: 3600, balance: -5, capturesGold: 10 };
result = vm.runInContext(reader, guest);
assert.equal(result.a.balance, -5, 'analyzer capture income is not counted twice');
state.ws.analyzer.capturesGold = 0;
result = vm.runInContext(reader, guest);
assert.equal(result.a.balance, 5, 'capture value covers the deficit when absent from the analyzer');
delete state.ws.analyzer;
state.meMiss = 2; state.sock.readyState = 0;
assert.equal(vm.runInContext(reader, guest).live, false, 'a lost connection is not reported as online');
guest.window.__poke = null;
guest.document = emptyDocument();
result = vm.runInContext(reader, guest);
assert.equal(result.live, false, 'an empty cold start is not reported as an online account');
assert.ok(guest.window.__poke.ws && guest.window.__poke.sess, 'a cold read initializes state for the upstream socket collector');

async function testShellReader() {
  let calls = 0, finish;
  const webview = {};
  const coordinator = runtime.createReadCoordinator(() => {
    calls++;
    return new Promise(resolve => { finish = () => resolve({ ok: true, live: true, cid: 'trainer-fixture', name: 'Conta fictícia', team: [{ name: 'Venusaur' }] }); });
  });
  const cache = {};
  const host = vm.createContext({
    window: { stCache: cache, stSane: d => d }, webviews: [webview], off: [false],
    states: new Map(), tabNames: [], baseState: i => ({ i, ok: false }),
    readPanelState: i => coordinator.read(i, webview)
  });
  const start = shell.indexOf('  async function collectOne(i) {');
  const end = shell.indexOf('  let collecting =', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(shell.slice(start, end), host);
  const sidebar = host.collectOne(0), otherReader = coordinator.read(0, webview);
  await Promise.resolve();
  assert.equal(calls, 1, 'upstream sidebar and another HUD consumer share one pending guest read');
  finish(); await Promise.all([sidebar, otherReader]);
  assert.equal(cache[0].d.cid, 'trainer-fixture', 'window fallback publishes the sanitized snapshot');
  assert.equal((await host.collectOne(0)).name, 'Conta fictícia');
  assert.equal(calls, 1, 'the sidebar reuses a valid recent snapshot');
  cache[0] = { t: Date.now(), d: { ok: true, live: true, team: [] } };
  const incomplete = host.collectOne(0);
  await Promise.resolve(); assert.equal(calls, 2, 'upstream rereads a partial snapshot without its team');
  finish(); await incomplete;
  cache[0] = { t: Date.now(), d: { ok: false } };
  const fresh = host.collectOne(0);
  await Promise.resolve(); assert.equal(calls, 3, 'an invalid snapshot does not hide the current state');
  finish(); await fresh;
}
let timeout;
Promise.race([testShellReader(), new Promise((_resolve, reject) => {
  timeout = setTimeout(() => reject(new Error('Sidebar integration check timed out')), 5000);
})]).then(() => {
  console.log('PASS: upstream collector syntax, live identity, team, selected supplies, native hunt session, economy scoreboard, disconnected state and shared sidebar reads.');
}).catch(error => { console.error(error); process.exitCode = 1; }).finally(() => clearTimeout(timeout));
