const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const runtime = require('../src/ui/runtime-performance');

async function testReads() {
  let calls = 0, finish;
  const coordinator = runtime.createReadCoordinator(source => {
    calls++;
    return new Promise(resolve => { finish = () => resolve({ account: source.account }); });
  });
  const guest = { account: 'first' };
  const readers = Array.from({ length: 30 }, () => coordinator.read(0, guest));
  await Promise.resolve();
  assert.equal(calls, 1, '30 simultaneous HUD readers execute one guest read');
  finish();
  const values = await Promise.all(readers);
  assert.ok(values.every(value => value.account === 'first'));
  assert.equal(coordinator.size, 0, 'resolved snapshots are released');
  const fresh = coordinator.read(0, guest);
  await Promise.resolve(); assert.equal(calls, 2, 'next sample is fresh, with no longer cache interval');
  finish(); await fresh;

  const resolvers = [];
  const navigation = runtime.createReadCoordinator(source => new Promise(resolve => resolvers.push(() => resolve(source))));
  const old = navigation.read(0, 'old-page');
  navigation.invalidate(0);
  const next = navigation.read(0, 'new-page');
  await Promise.resolve();
  resolvers[0](); assert.equal(await old, 'old-page');
  assert.equal(navigation.size, 1, 'old completion cannot remove the current page request');
  resolvers[1](); assert.equal(await next, 'new-page'); assert.equal(navigation.size, 0);

  const rejection = runtime.createReadCoordinator(() => Promise.reject(new Error('guest closed')));
  await assert.rejects(rejection.read(0, guest), /guest closed/);
  assert.equal(rejection.size, 0, 'failed reads do not retain guests');
}

function testHistories() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const messages = [], celebrations = [];
  const context = vm.createContext({
    RebosteioPerformance: runtime, lifeShiny: [], lifeCatch: [], huntLog: [],
    tabNames: ['Paused', 'Active'], ACOR: ['#fff'], stName: i => 'Account ' + i,
    whCfg: { shiny: true }, alertsOn: false, t: key => key,
    webhookSend: text => messages.push(text), festaShiny: event => celebrations.push(event),
    lsSet() {}, cap: value => value, hlNum: value => Number(value) || 0,
    hlTxt: (value, limit = 40) => String(value || '').slice(0, limit), window: { pokeAPI: null }
  });
  const logStart = html.indexOf('  const kSh =');
  const logEnd = html.indexOf('  // ----- Farm parado:', logStart);
  assert.ok(logStart > 0 && logEnd > logStart);
  vm.runInContext(html.slice(logStart, logEnd), context);
  // First batch is silent. Repeated batches must not replay alerts or celebrations.
  vm.runInContext("mergeLogs(0,{shinyLog:[{n:'Gastly',t:1,cap:1}],catchLog:[{n:'Gastly',t:1,sh:true,iv:123}]})", context);
  assert.equal(messages.length, 0);
  for (let i = 2; i <= 5000; i++) {
    context.batch = { shinyLog: [{ n: 'Gastly', t: i, cap: 1 }], catchLog: [{ n: 'Gastly', t: i, sh: true, iv: 123 }] };
    vm.runInContext('mergeLogs(1,batch);mergeLogs(1,batch)', context);
  }
  assert.equal(messages.length, 4998, 'each fresh shiny alerts once after the initial silent batch');
  assert.equal(celebrations.length, 4998);
  assert.equal(context.lifeShiny.length, 500); assert.equal(context.lifeCatch.length, 300);
  assert.ok(vm.runInContext('seenLog.size', context) <= 802, 'deduplication memory follows retained history and paused sources');
  const previous = messages.length;
  vm.runInContext("mergeLogs(0,{shinyLog:[{n:'Gastly',t:1,cap:1}],catchLog:[{n:'Gastly',t:1,sh:true,iv:123}]})", context);
  assert.equal(messages.length, previous, 'a paused account is not counted or alerted again after history pruning');
  context.batch = { catchLog: [{ n: 'Gastly', t: 5000, sh: true, iv: 123, ivs: { hp: 10 }, id: 'capture-id' }] };
  vm.runInContext('mergeLogs(1,batch)', context);
  const last = context.lifeCatch.at(-1);
  assert.equal(last.id, 'capture-id'); assert.equal(last.ivs.hp, 10, 'late IV details still update an existing capture');
  assert.equal(context.lifeCatch.length, 300, 'adding a capture ID does not duplicate its history entry');
  context.batch = { catchLog: [{ n: 'Pikachu', t: 6000, ivs: { hp: 10, atk: 20, def: 15, spAtk: 12, spDef: 14, speed: 18 } }] };
  vm.runInContext('mergeLogs(1,batch)', context);
  assert.equal(context.lifeCatch.at(-1).iv, 89, 'upstream IV totals are recovered from the individual stats');
  vm.runInContext('mergeLogs(1,batch)', context);
  assert.equal(context.lifeCatch.length, 300, 'repeated enriched captures remain deduplicated');

  const huntStart = html.indexOf('  const hlVistos =');
  const huntEnd = html.indexOf('  // Exporta duas planilhas:', huntStart);
  vm.runInContext(html.slice(huntStart, huntEnd), context);
  vm.runInContext('registraHunt(0,{start:1,kills:1})', context);
  for (let i = 2; i <= 10000; i++) {
    context.hunt = { start: i, kills: 1, end: i + 1 };
    vm.runInContext('registraHunt(1,hunt)', context);
  }
  assert.equal(context.huntLog.length, 150);
  assert.ok(vm.runInContext('hlVistos.size', context) <= 151);
  vm.runInContext('registraHunt(0,{start:1,kills:1})', context);
  assert.equal(context.huntLog.at(-1).start, 10000, 'paused hunt does not return after being archived/pruned');
}

function testDom() {
  let writes = 0, text = '0/4', attr = 'false';
  const element = { get textContent() { return text; }, set textContent(value) { text = value; writes++; },
    getAttribute() { return attr; }, setAttribute(_name, value) { attr = value; writes++; } };
  for (let i = 0; i < 1000; i++) { runtime.setText(element, '0/4'); runtime.setAttribute(element, 'aria-pressed', false); }
  assert.equal(writes, 0, 'unchanged HUD values cause no DOM writes');
  runtime.setText(element, '4/4'); runtime.setAttribute(element, 'aria-pressed', true);
  assert.equal(writes, 2, 'changed values still update immediately');
}

(async () => {
  await testReads(); testHistories(); testDom();
  console.log('PASS: shared fresh reads, bounded history indexes, deduplicated alerts, late capture details and unchanged DOM values.');
})().catch(error => { console.error(error); process.exitCode = 1; });
