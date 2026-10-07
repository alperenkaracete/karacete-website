// "Mini oyunlarda bazen tıklanmıyor, sayfayı yenileyince düzeliyor": Parti kök düğümü minioyunlar arasında kalıcıdır;
// sonuçta/atış sınırında eklenen `pt-duel-locked` (tahtayı tıklamaya kapatır) sonraki düelloya taşınıyordu.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Adapter = require('../games/parti/mini/duel-adapter.js');
const X = require('../games/xox-rules.js');
const { fakeRoot, makeDefs, clock } = require('./duel-fakes.js');

function start(root, clk, extra) {
    const ac = new AbortController();
    const defs = makeDefs('xox', X);
    const promise = Adapter.run(Object.assign({
        type: 'duel', game: 'xox', players: ['A', 'B'], seed: 7, me: { id: 'A', name: 'Ayşe' }, isLeader: true, leader: 'A',
        root, net: { send() {}, on: () => () => {} }, deadlineMs: 1000, signal: ac.signal, defs, names: { A: 'Ayşe', B: 'Bora' },
        timers: clk.timers, now: clk.now
    }, extra || {}));
    return { ac, promise };
}

test('önceki düellonun kilidi sonraki düelloda temizlenir (aynı kalıcı kök düğüm)', async () => {
    const root = fakeRoot();
    const clk = clock();
    const s1 = start(root, clk);
    clk.advance(1000);                                   // süre doldu: sonuç -> tahta kilitlenir
    const res = await s1.promise;
    assert.equal(res.reason, 'timeout');
    assert.ok(root.classList.set.has('pt-duel-locked'), 'sonuçta tahta kilitlendi (bu doğru)');
    s1.ac.abort();                                       // makine oturumu hold sonunda kapatır
    assert.ok(!root.classList.set.has('pt-duel-locked'), 'oturum kapanınca kilit kalkar');
    // Eski sürümdeki gibi kapanışta temizlenmemiş bir kök düğüm (ör. başka yol) de yeni düelloyu kilitli bırakmamalı
    root.classList.add('pt-duel-locked');
    const s2 = start(root, clk, { deadlineMs: 0 });
    assert.ok(!root.classList.set.has('pt-duel-locked'), 'yeni düello kilitsiz başlar');
    assert.ok(root.classList.set.has('pt-duel'), 'düello sınıfı eklenir');
    s2.ac.abort();
    assert.ok(!root.classList.set.has('pt-duel'), 'kapanışta düello sınıfı da kalkar');
});

test('kilit yalnız sonuç/sınırdan sonra gelir: oyun sürerken tahta tıklanabilir', async () => {
    const root = fakeRoot();
    const clk = clock();
    const s = start(root, clk, { deadlineMs: 0 });
    assert.ok(!root.classList.set.has('pt-duel-locked'));
    s.ac.abort();
    const out = await s.promise;
    assert.equal(out.aborted, true);
});

test('kilit CSS kuralı tahta sarmalayıcısını hedefler ve yalnız adaptör tarafından yönetilir (ui.js sınıfı eklemez/silmez)', () => {
    const root = path.join(__dirname, '..');
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    assert.ok(/\.pt-duel-locked \.duel-board-wrap\s*\{\s*pointer-events:\s*none/.test(css));
    const ui = fs.readFileSync(path.join(root, 'games', 'parti', 'ui.js'), 'utf8');
    assert.ok(!/pt-duel-locked/.test(ui));
    const adapter = fs.readFileSync(path.join(root, 'games', 'parti', 'mini', 'duel-adapter.js'), 'utf8');
    assert.ok(/classList\.remove\('pt-duel-locked'\);\s*\n\s*if \(spec\.root && spec\.root\.classList\) spec\.root\.classList\.add\('pt-duel'\)/.test(adapter.replace(/\r/g, '')), 'başlangıçta temizlenir');
});
