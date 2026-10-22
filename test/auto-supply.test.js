'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('    // ----- Auto Supply');
const end = html.indexOf('    // ===== Sistema de Bônus Twitch', start);
const source = html.slice(start, end);

function harness({ rejected = false, offline = false, gold = 200000, stocks = {}, selected = [0, 1, 2, 3] } = {}) {
  const config = {
    enabled: true, buyPartial: true, selectedAccounts: selected,
    defaultCfg: {
      balls: { enabled: true, selectedId: 4, min: 39, target: 1000 },
      potions: { enabled: true, selectedId: 200, min: 5, target: 100 },
      revives: { enabled: false, selectedId: 205, min: 10, target: 50 }
    },
    accountCfgs: Object.fromEntries([1, 2, 3].map(i => [i, {
      custom: true, balls: { enabled: true, selectedId: 3, min: 150, target: 1000 },
      potions: { enabled: true, selectedId: 200, min: 1, target: 200 },
      revives: { enabled: true, selectedId: 205, min: 10, target: 50 }
    }]))
  };
  const store = { autoSupplyCfg: JSON.stringify(config), autoSupplyOn: '1' };
  const logs = [], sent = [], sockets = [], reads = [], ticks = [], controls = new Map();
  const states = Array.from({ length: 4 }, () => ({
    ok: true, live: true, gold, balls: 900, potions: 333, revives: 80,
    ballMap: { 3: 900, ...stocks }, invMap: { 201: 333 }, team: []
  }));
  const webviews = states.map((state, i) => {
    const socket = new EventEmitter();
    socket.readyState = offline ? 3 : 1;
    socket.addEventListener = socket.on.bind(socket);
    socket.removeEventListener = socket.off.bind(socket);
    const eu = { balls: { ...state.ballMap }, items: { ...state.invMap } };
    socket.send = data => {
      const order = JSON.parse(data);
      sent.push({ i, ...order });
      queueMicrotask(() => {
        const field = order.kind === 'ball' ? 'balls' : 'items';
        // A normal state tick for another item must not confirm a rejected purchase.
        if (rejected) return socket.emit('message', { data: JSON.stringify({ t: 'estado', estado: { [field]: { 999: 20 } } }) });
        eu[field][order.id] = (+eu[field][order.id] || 0) + order.qty;
        (order.kind === 'ball' ? state.ballMap : state.invMap)[order.id] = eu[field][order.id];
        socket.emit('message', { data: JSON.stringify({ t: 'estado', estado: { [field]: { [order.id]: eu[field][order.id] } } }) });
      });
    };
    sockets.push(socket);
    const guest = vm.createContext({
      window: { __poke: { sock: socket }, estado: { ws: socket, eu } },
      setTimeout: fn => setTimeout(fn, 5), clearTimeout
    });
    return { executeJavaScript: code => vm.runInContext(code, guest) };
  });
  const ctx = vm.createContext({
    window: { pokeAPI: { logError: (_origin, message) => logs.push(message) } },
    document: { getElementById: id => controls.get(id) || null, addEventListener() {} },
    lsGet: key => store[key], lsSet: (key, value) => { store[key] = value; },
    count: 4, off: [], webviews, accounts: [],
    stCache: Object.fromEntries(states.map((_, i) => [i, { d: { ok: true, ballMap: { 4: 1000 } } }])),
    catalogCache: null, itensCache: null,
    readPanelState: async i => { reads.push(i); return structuredClone(states[i]); },
    stateReads: { invalidate() {} },
    stName: i => 'Conta ' + (i + 1), nf: String, esc: String,
    setInterval: fn => { ticks.push(fn); }, setTimeout, clearTimeout
  });
  vm.runInContext(source, ctx);
  return { ctx, sent, logs, sockets, reads, ticks, store, config, controls, run: code => vm.runInContext(code, ctx) };
}

(async () => {
  const h = harness();
  // Trigger the actual automatic scheduler, not only the manual button.
  h.ticks[0]();
  while (h.run('autoSupplyExecuting')) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(h.sent.length, 8, 'four accounts buy their missing Ultra Balls and Small Potions');
  for (let i = 0; i < 4; i++) {
    assert.deepEqual(h.sent.filter(o => o.i === i), [
      { i, t: 'shop.buy', kind: 'ball', id: 4, qty: 1000 },
      { i, t: 'shop.buy', kind: 'item', id: 200, qty: 100 }
    ], 'hidden legacy overrides and other stocked items do not change the displayed rule');
  }
  assert.ok(h.reads.length >= 8, 'automatic supply obtains fresh state despite stale sidebar cache');
  assert.ok(h.logs.some(s => s.startsWith('✅') && s.includes('Ultra Ball')));
  await h.run('executeAutoSupply(false)');
  assert.equal(h.sent.length, 8, 'confirmed stock prevents duplicate purchases');
  for (const socket of h.sockets) assert.equal(socket.listenerCount('message') + socket.listenerCount('close'), 0);

  const individual = harness();
  individual.run('autoSupplyCfg.individualRulesVersion = 2; autoSupplyCfg.accountCfgs = {1: {custom:true, balls:{enabled:true,selectedId:3,min:950,target:1200},potions:{enabled:false,selectedId:200,min:5,target:100},revives:{enabled:false,selectedId:205,min:10,target:50}}}');
  individual.run('saveAutoSupplyCfg(autoSupplyCfg)');
  await individual.run('executeAutoSupply(false)');
  assert.deepEqual(individual.sent.filter(o => o.i === 1), [{i:1,t:'shop.buy',kind:'ball',id:3,qty:300}], 'explicit individual policy controls its own item, minimum and target');
  assert.equal(individual.sent.filter(o => o.i === 0).length, 2, 'other accounts retain the common policy');
  individual.run('autoSupplyDraft=JSON.parse(JSON.stringify(autoSupplyCfg));autoSupplyDraft.selectedAccounts=[1];autoSupplyScope="selected"');
  assert.equal(individual.run('getActiveScopeConfig().balls.selectedId'), 3);
  individual.run('delete autoSupplyDraft.accountCfgs[1]');
  assert.equal(individual.run('getActiveScopeConfig().balls.selectedId'), 4, 'disabling customization returns to common rules');
  individual.run('saveAutoSupplyCfg(autoSupplyCfg)');
  assert.equal(individual.run('loadAutoSupplyCfg().accountCfgs[1].balls.target'),1200,'individual rules survive reload');

  const failed = harness({ rejected: true });
  await failed.run('executeAutoSupply(false)');
  assert.equal(failed.sent.length, 4, 'no further orders after an unconfirmed purchase');
  assert.ok(failed.logs.every(s => !s.includes('✅')));
  assert.ok(failed.logs.some(s => s.includes('estoque não confirmado')));
  for (const socket of failed.sockets) assert.equal(socket.listenerCount('message') + socket.listenerCount('close'), 0);

  const offline = harness({ offline: true });
  await offline.run('executeAutoSupply(true)');
  assert.equal(offline.sent.length, 0);
  assert.ok(offline.logs.some(s => s.includes('sem conexão')));
  assert.ok(offline.logs.every(s => !s.includes('✅')));

  const noGold = harness({ gold: 0 });
  await noGold.run('executeAutoSupply(true)');
  assert.equal(noGold.sent.length, 0);
  assert.ok(noGold.logs.some(s => s.includes('saldo insuficiente')));

  const partial = harness({ gold: 1300, selected: [2] });
  await partial.run('executeAutoSupply(false)');
  assert.deepEqual(partial.sent, [{ i: 2, t: 'shop.buy', kind: 'ball', id: 4, qty: 10 }]);

  const infinite = harness({ stocks: { 4: '∞' }, selected: [0] });
  await infinite.run('executeAutoSupply(false)');
  assert.ok(infinite.sent.every(o => o.kind !== 'ball'));

  h.store.autoSupplyCfg = JSON.stringify({ enabled: true, scope: [1], balls: { selectedId: 4, min: 2, target: 5000 } });
  const migrated = h.run('loadAutoSupplyCfg()');
  assert.equal(migrated.defaultCfg.balls.selectedId, 4);
  assert.equal(migrated.defaultCfg.balls.target, 5000);
  assert.deepEqual(Array.from(migrated.selectedAccounts), [1]);
  console.log('Auto Supply: scheduler, four accounts, legacy rules, zero stock, confirmations, timeout, offline, balance, partial purchase, infinity and migration passed.');
})().catch(e => { console.error(e); process.exitCode = 1; });
