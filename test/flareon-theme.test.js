const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const root = path.resolve(__dirname, '..');
const flareonDir = path.join(root, 'src/ui/themes/pokemon/flareon');

// 1. Files exist
assert.ok(fs.existsSync(path.join(flareonDir, 'exclusive-theme.json')), 'exclusive-theme.json exists');
assert.ok(fs.existsSync(path.join(flareonDir, 'cutout-exclusive.png')), 'cutout-exclusive.png exists');
assert.ok(fs.existsSync(path.join(flareonDir, 'panorama-exclusive.png')), 'panorama-exclusive.png exists');
assert.ok(fs.existsSync(path.join(flareonDir, 'ARTWORK.md')), 'ARTWORK.md exists');

// 2. Catalog check
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'src/ui/themes/pokemon/all-pokemon.json'), 'utf8'));
const theme = catalog.find(t => t.id === 'pkmn-flareon');
assert.ok(theme, 'Flareon found in catalog');
assert.strictEqual(theme.exclusive, true, 'Flareon is marked exclusive');
assert.strictEqual(theme.assets.cutout, 'src/ui/themes/pokemon/flareon/cutout-exclusive.png');
assert.strictEqual(theme.assets.panorama, 'src/ui/themes/pokemon/flareon/panorama-exclusive.png');

// 3. JS catalog sync
const jsSource = fs.readFileSync(path.join(root, 'src/ui/themes/pokemon/all-pokemon.js'), 'utf8');
assert.ok(jsSource.includes('"id": "pkmn-flareon"'), 'JS has pkmn-flareon');
assert.ok(jsSource.includes('src/ui/themes/pokemon/flareon/cutout-exclusive.png'), 'JS has cutout path');

// 4. CSS check
const cssSource = fs.readFileSync(path.join(root, 'src/ui/themes.css'), 'utf8');
assert.ok(cssSource.includes('body[data-theme="pkmn-flareon"]'), 'CSS has body[data-theme="pkmn-flareon"]');
assert.ok(cssSource.includes('body[data-pokemon="pkmn-flareon"]'), 'CSS has body[data-pokemon="pkmn-flareon"]');

// 5. Theme manager check
const tmSource = fs.readFileSync(path.join(root, 'src/ui/theme-manager.js'), 'utf8');
assert.ok(tmSource.includes("'pkmn-flareon': true"), 'theme-manager has pkmn-flareon in HEADER_ART');

console.log('ALL FLAREON CHECKS PASSED!');
