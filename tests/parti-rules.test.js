const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const G = require('../games/parti/graph.js');
const R = require('../games/parti/rules.js');
const pirate = require('../games/parti/maps/pirate.js');

const g = G.index(pirate);
const ctx = (extra) => Object.assign({ g }, extra);

function seats(n, opts) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ id: 'p' + i, name: 'Oyuncu' + i, av: C.AVATARS[i], t: (opts && opts.teams) ? Math.floor(i / 2) : 0 });
    return out;
}

// Sırayı sabitle: p0 sıradaki
function game(n, cfg, seed) {
    const s = R.createGame({ seed: seed || 5, cfg: Object.assign({ mode: 'solo', goal: 10, map: 'pirate' }, cfg), seats: seats(n, { teams: cfg && cfg.mode === 'team' }) }, ctx());
    s.chests = {};
    s.order = s.order.slice().sort();
    s.turn = 0;
    s.stage = 'roll';
    return s;
}

function apply(state, action, extra) {
    const r = R.reduce(state, action, ctx(extra));
    assert.ok(r.ok, 'reddedildi: ' + r.error);
    return r;
}

// düğüm x'ten d adım uzaktaki (yönsüz) düğüm
function nodeAt(from, d, skip) {
    const dist = G.distances(g, from);
    return Object.keys(dist).map(Number).filter((n) => dist[n] === d && (!skip || !skip.includes(n)))[0];
}

const loopNode = pirate.nodes.find((n) => n.type === 'normal' && n.next.length === 1);

test('kurulum: herkes kendi başlangıcında, 100 can, 0 yıldız; ceil(n/2)+1 yıldız + 1 silah sandığı çıkar', () => {
    const s = R.createGame({ seed: 3, cfg: { mode: 'solo', goal: 10, map: 'pirate' }, seats: seats(8) }, ctx());
    const starts = new Set();
    s.order.forEach((id) => { starts.add(s.P[id].pos); assert.equal(s.P[id].hp, 100); assert.equal(s.P[id].s, 0); assert.equal(g.byId[s.P[id].pos].type, 'start'); });
    assert.equal(starts.size, 8);
    const chests = Object.values(s.chests);
    assert.equal(chests.filter((c) => c.k === 'star').length, 5, '8 oyuncu: ceil(8/2)+1');
    assert.equal(chests.filter((c) => c.k === 'weapon').length, 1);
    Object.keys(s.chests).forEach((n) => assert.equal(g.byId[n].type, 'treasure'));
    assert.equal(s.stage, 'roll');
});

test('zar 1-6, adım adım yürür, varış düğümünde durur; sonra "act" evresi', () => {
    let s = game(2);
    const start = loopNode.id;
    s.P.p0.pos = start;
    for (let v = 1; v <= 6; v++) {
        const r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => v });
        const moved = r.events.find((e) => e.t === 'move');
        assert.ok(r.events.some((e) => e.t === 'roll' && e.v === v));
        assert.ok(!moved || moved.path.length <= v);
    }
    const r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 1 });
    assert.equal(r.state.P.p0.pos, loopNode.next[0]);
    assert.ok(['act', 'swap'].includes(r.state.stage));
});

test('sıra kimde değilse ya da evre yanlışsa eylem reddedilir', () => {
    const s = game(3);
    assert.equal(R.reduce(s, { type: 'roll', by: 'p1' }, ctx()).ok, false);
    assert.equal(R.reduce(s, { type: 'end', by: 'p0' }, ctx()).ok, false);
    assert.equal(R.reduce(s, { type: 'dir', by: 'p0', to: 1 }, ctx()).ok, false);
    assert.equal(R.reduce(s, { type: 'nope', by: 'p0' }, ctx()).ok, false);
    assert.equal(R.reduce(s, null, ctx()).ok, false);
});

test('dallanma: yön sorar, geçersiz yön reddedilir, seçilen yönde kalan adımlar yürünür', () => {
    const branch = pirate.nodes.find((n) => n.next.length > 1);
    const s = game(2);
    // dallanma düğümünden 2 adım önceki düğüm
    const pre = pirate.nodes.find((n) => n.next.length === 1 && g.byId[n.next[0]].next.length === 1 && g.byId[g.byId[n.next[0]].next[0]].id === branch.id);
    s.P.p0.pos = pre.id;
    let r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 5 });
    assert.equal(r.state.stage, 'choose');
    assert.equal(r.state.P.p0.pos, branch.id);
    assert.equal(r.state.steps, 3);
    assert.deepEqual(r.state.choices, branch.next);
    assert.equal(R.reduce(r.state, { type: 'dir', by: 'p0', to: -5 }, ctx()).ok, false);
    const r2 = apply(r.state, { type: 'dir', by: 'p0', to: branch.next[1] });
    assert.equal(r2.state.P.p0.pos === branch.id, false);
    assert.equal(r2.events.find((e) => e.t === 'move').path[0], branch.next[1]);
    assert.ok(['act', 'swap'].includes(r2.state.stage));
});

test('sandık: üzerinden geçen alır (yıldız), duran alır; envanter dolu silah için seçim sunar', () => {
    const s = game(2);
    const a = pirate.nodes.find((n) => n.type !== 'start' && n.next.length === 1 && g.byId[n.next[0]].next.length === 1 && g.byId[g.byId[n.next[0]].next[0]].next.length === 1);
    const mid = a.next[0];
    const end = g.byId[mid].next[0];
    s.P.p0.pos = a.id;
    s.chests[mid] = { k: 'star', n: 2 };
    let r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 2 });       // sandığın üzerinden geçer, ucunda durur
    assert.equal(r.state.P.p0.s >= 2, true);
    assert.equal(r.state.chests[mid], undefined);
    assert.ok(r.events.some((e) => e.t === 'chest' && e.node === mid && e.n === 2));
    const s2 = game(2);
    s2.P.p0.pos = a.id;
    s2.chests[end] = { k: 'star', n: 1 };
    r = apply(s2, { type: 'roll', by: 'p0' }, { dice: () => 2 });            // üzerinde durur
    assert.ok(r.state.P.p0.s >= 1);
    // dolu envanter: silah sandığı seçim sunar
    const s3 = game(2);
    s3.P.p0.pos = a.id;
    s3.P.p0.w = ['fist', 'fist', 'bow'];
    s3.chests[mid] = { k: 'weapon' };
    r = apply(s3, { type: 'roll', by: 'p0' }, { dice: () => 2 });
    if (g.byId[r.state.P.p0.pos].type === 'normal') {
        assert.equal(r.state.stage, 'swap');
        assert.equal(r.state.P.p0.offers.length, 1);
        const offered = r.state.P.p0.offers[0];
        const dropped = apply(r.state, { type: 'swap', by: 'p0', drop: 2 });
        assert.equal(dropped.state.P.p0.w.length, 3);
        assert.equal(dropped.state.P.p0.w[2], offered);
        assert.equal(dropped.state.stage, 'act');
        const declined = apply(r.state, { type: 'swap', by: 'p0', drop: -1 });
        assert.deepEqual(declined.state.P.p0.w, ['fist', 'fist', 'bow']);
        assert.equal(R.reduce(r.state, { type: 'swap', by: 'p0', drop: 9 }, ctx()).ok, false);
    }
});

test('sandık turun başında üstünde duran oyuncuya hemen verilir', () => {
    const s = game(2);
    const treasure = pirate.nodes.find((n) => n.type === 'treasure').id;
    s.P.p1.pos = treasure;
    for (let i = 0; i < 40; i++) {
        const t = JSON.parse(JSON.stringify(s));
        t.rs = i + 1;
        R.spawnChests(t, g, { f: () => 0.5, int: () => 0, pick: (a) => a[0], shuffle: (a) => a.slice() }, []);
        if (t.chests[treasure] === undefined && Object.keys(t.chests).length) { assert.ok(t.P.p1.s > 0 || t.P.p1.w.length > 0); return; }
    }
});

// ---- Silahlar ----
function duelSetup(weapon, dist) {
    const s = game(2);
    const a = loopNode.id;
    const b = nodeAt(a, dist);
    s.P.p0.pos = a;
    s.P.p1.pos = b;
    s.P.p0.w = [weapon];
    s.stage = 'act';
    return s;
}

test('yumruk: menzil 1, hasar 30; menzil dışı reddedilir', () => {
    const s = duelSetup('fist', 1);
    const r = apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' });
    assert.equal(r.state.P.p1.hp, 70);
    assert.equal(r.state.P.p0.w.length, 0, 'tek atımlık');
    assert.equal(r.state.stage === 'act', false, 'saldırı turu bitirir');
    const far = duelSetup('fist', 2);
    assert.equal(R.reduce(far, { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok, false);
});

test('pompalı: 1/2/3 adımda 45/30/15; 4 adım menzil dışı (mesafe düşüşü)', () => {
    const want = { 1: 45, 2: 30, 3: 15 };
    for (const d of [1, 2, 3]) {
        const r = apply(duelSetup('shotgun', d), { type: 'use', by: 'p0', item: 0, target: 'p1' });
        assert.equal(100 - r.state.P.p1.hp, want[d], d + ' adım');
    }
    assert.equal(R.reduce(duelSetup('shotgun', 4), { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok, false);
});

test('yay: menzil 5, hasar 20', () => {
    assert.equal(100 - apply(duelSetup('bow', 5), { type: 'use', by: 'p0', item: 0, target: 'p1' }).state.P.p1.hp, 20);
    assert.equal(R.reduce(duelSetup('bow', 6), { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok, false);
});

test('bomba: seçilen kutucuktaki herkese (kendisi dahil) 30; menzil 4', () => {
    const s = game(4);
    const a = loopNode.id;
    const target = nodeAt(a, 2);
    s.P.p0.pos = a;
    s.P.p1.pos = target;
    s.P.p2.pos = target;
    s.P.p3.pos = nodeAt(a, 4);
    s.P.p0.w = ['bomb'];
    s.stage = 'act';
    let r = apply(s, { type: 'use', by: 'p0', item: 0, node: target });
    assert.equal(r.state.P.p1.hp, 70);
    assert.equal(r.state.P.p2.hp, 70);
    assert.equal(r.state.P.p3.hp, 100);
    assert.equal(r.state.P.p0.hp, 100);
    // kendi kutucuğuna atarsa kendisi de yaralanır
    s.P.p1.pos = a;
    r = apply(s, { type: 'use', by: 'p0', item: 0, node: a });
    assert.equal(r.state.P.p0.hp, 70);
    assert.equal(r.state.P.p1.hp, 70);
    assert.equal(R.reduce(s, { type: 'use', by: 'p0', item: 0, node: nodeAt(a, 5) }, ctx()).ok, false);
});

test('kalkan: kurmak turu harcamaz; bir sonraki saldırıyı engeller ve tükenir; ikinci kez kurulamaz', () => {
    const s = duelSetup('fist', 1);
    s.P.p1.w = ['shield', 'shield'];
    // p1 sırası gelince kalkan kurar
    const t = JSON.parse(JSON.stringify(s));
    t.turn = 1; t.stage = 'act';
    let r = apply(t, { type: 'use', by: 'p1', item: 0 });
    assert.equal(r.state.P.p1.shield, true);
    assert.equal(r.state.stage, 'act', 'tur devam eder');
    assert.equal(r.state.P.p1.w.length, 1);
    assert.equal(R.reduce(r.state, { type: 'use', by: 'p1', item: 0 }, ctx()).ok, false, 'zaten kalkan var');
    // saldırı engellenir
    const u = JSON.parse(JSON.stringify(r.state));
    u.turn = 0;
    r = apply(u, { type: 'use', by: 'p0', item: 0, target: 'p1' });
    assert.equal(r.state.P.p1.hp, 100);
    assert.equal(r.state.P.p1.shield, false);
    assert.ok(r.events.some((e) => e.t === 'block'));
    assert.equal(r.state.P.p0.w.length, 0, 'silah yine de harcandı');
});

test('kalkan bomba hasarını da engeller (kendi bombasında bile)', () => {
    const s = duelSetup('bomb', 1);
    s.P.p0.shield = true;
    const r = apply(s, { type: 'use', by: 'p0', item: 0, node: s.P.p0.pos });
    assert.equal(r.state.P.p0.hp, 100);
    assert.equal(r.state.P.p0.shield, false);
});

// ---- Ölüm ----
test('ölüm: min(3, yarısı) yıldız saldırana gider; başlangıca döner, can dolar, tur ATLATILMAZ, envanter korunur', () => {
    const s = duelSetup('fist', 1);
    s.P.p1.hp = 20;
    s.P.p1.s = 5;
    s.P.p1.w = ['bow'];
    s.P.p0.s = 1;
    const r = apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' });
    assert.equal(r.state.P.p1.s, 3, '5 yıldız: floor(5/2)=2 kaybolur');
    assert.equal(r.state.P.p0.s, 3);
    assert.equal(r.state.P.p1.hp, 100);
    assert.equal(r.state.P.p1.pos, s.P.p1.home);
    assert.equal(r.state.P.p1.sk, 0, 'ölümde tur atlatma yok');
    assert.ok(!r.events.some((e) => e.t === 'skip'));
    assert.equal(r.state.stage, 'roll', 'sıra ölen oyuncuya geçer (atlatılmaz)');
    assert.equal(R.current(r.state), 'p1');
    assert.deepEqual(r.state.P.p1.w, ['bow']);
    assert.ok(r.events.some((e) => e.t === 'death' && e.id === 'p1' && e.killer === 'p0' && e.lost === 2));
});

test('ölüm: bomba/çoklu hedefte en çok hasar veren yıldızları alır; kendi bombasıyla ölenin yıldızı kimseye gitmez', () => {
    const s = game(3);
    const a = loopNode.id;
    s.P.p2.pos = a; s.P.p2.hp = 30; s.P.p2.s = 6;
    s.P.p2.dmg = { p0: 10, p1: 50 };            // önceki saldırılar
    s.P.p0.pos = nodeAt(a, 1);
    s.P.p0.w = ['bomb'];
    s.stage = 'act';
    let r = apply(s, { type: 'use', by: 'p0', item: 0, node: a });
    assert.equal(r.state.P.p2.s, 3);
    assert.equal(r.state.P.p1.s, 3, 'en çok hasar veren p1');
    assert.equal(r.state.P.p0.s, 0);
    const t = game(2);
    t.P.p0.pos = loopNode.id; t.P.p0.hp = 20; t.P.p0.s = 4; t.P.p0.w = ['bomb']; t.stage = 'act';
    r = apply(t, { type: 'use', by: 'p0', item: 0, node: loopNode.id });
    assert.equal(r.state.P.p0.s, 2);
    assert.equal(r.state.P.p1.s, 0);
});

test('tuzak olayı can azaltır; ölürse tur biter', () => {
    const s = game(2);
    s.P.p0.hp = 10;
    s.P.p0.s = 3;
    const ev = pirate.nodes.find((n) => n.type === 'event');
    const before = ev.id;
    // olay düğümünün önündeki düğümü bul
    const pre = pirate.nodes.find((n) => n.next.length === 1 && n.next[0] === before);
    s.P.p0.pos = pre.id;
    // damage olayını zorla: rastgele f ağırlıklı seçimde damage aralığına denk gelsin (star 3, damage 3 -> [0.27,0.55))
    const r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 1, rand: () => 0.4 });
    assert.ok(r.events.some((e) => e.t === 'event' && e.e === 'damage'));
    assert.ok(r.events.some((e) => e.t === 'death' && e.id === 'p0'));
    assert.equal(r.state.order[r.state.turn], 'p1', 'sıra geçti');
    assert.equal(r.state.P.p0.s, 2);
    assert.equal(r.state.P.p0.hp, 100);
});

// ---- Takım ----
test('takım: arkadaşa saldırı yasak, bomba arkadaşa vurmaz ama kendine vurur; yıldızlar ortak havuzda', () => {
    const s = game(4, { mode: 'team' });
    const a = loopNode.id;
    s.P.p0.pos = a; s.P.p1.pos = nodeAt(a, 1); s.P.p2.pos = nodeAt(a, 1, [s.P.p1.pos]) || nodeAt(a, 2);
    assert.equal(s.P.p0.t, s.P.p1.t);
    s.P.p0.w = ['fist', 'bomb'];
    s.stage = 'act';
    assert.equal(R.reduce(s, { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok, false);
    s.P.p2.pos = s.P.p1.pos;
    const r = apply(s, { type: 'use', by: 'p0', item: 1, node: s.P.p1.pos });
    assert.equal(r.state.P.p1.hp, 100, 'takım arkadaşı yara almadı');
    assert.equal(r.state.P.p2.hp, 70, 'rakip yara aldı');
    const own = apply(s, { type: 'use', by: 'p0', item: 1, node: a });
    assert.equal(own.state.P.p0.hp, 70);
    s.P.p0.s = 2; s.P.p1.s = 3;
    assert.equal(R.teamStars(s, 0), 5);
});

test('kazanma: bireyselde hedef yıldıza ulaşan anında kazanır', () => {
    const s = game(2, { goal: 5 });
    s.P.p0.s = 4;
    const a = pirate.nodes.find((n) => n.next.length === 1 && g.byId[n.next[0]].next.length === 1);
    s.P.p0.pos = a.id;
    s.chests[a.next[0]] = { k: 'star', n: 1 };
    const r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 1 });
    assert.deepEqual(r.state.winner, { kind: 'player', id: 'p0' });
    assert.equal(r.state.stage, 'over');
    assert.equal(R.reduce(r.state, { type: 'roll', by: 'p0' }, ctx()).ok, false);
});

test('kazanma: takımda toplam yıldız hedefe ulaşınca takım kazanır (kayıplar havuzdan düşer)', () => {
    const s = game(4, { mode: 'team', goal: 6 });
    s.P.p0.s = 3; s.P.p1.s = 2;
    const a = pirate.nodes.find((n) => n.next.length === 1 && g.byId[n.next[0]].next.length === 1);
    s.P.p1.pos = a.id;
    s.turn = 1;
    s.chests[a.next[0]] = { k: 'star', n: 1 };
    const r = apply(s, { type: 'roll', by: 'p1' }, { dice: () => 1 });
    assert.deepEqual(r.state.winner, { kind: 'team', id: 0 });
    assert.equal(R.teamStars(r.state, 0), 6);
    // kayıp: ölen takım arkadaşının yıldızı havuzdan düşer
    const t = game(4, { mode: 'team', goal: 20 });
    t.P.p0.s = 6;
    t.P.p0.hp = 5;
    t.P.p2.pos = loopNode.id; t.P.p3.pos = loopNode.id;
    t.P.p0.pos = nodeAt(loopNode.id, 1);
    t.turn = 2; t.stage = 'act'; t.P.p2.w = ['fist'];
    const r2 = apply(t, { type: 'use', by: 'p2', item: 0, target: 'p0' });
    assert.equal(R.teamStars(r2.state, 0), 3);
    assert.equal(R.teamStars(r2.state, 1), 3);
});

// ---- Minioyun ödülleri ----
test('sıralama dereceleri: eşit gruplar aynı derece, sonraki atlar', () => {
    assert.deepEqual(R.ranksOf([['a'], ['b', 'c'], ['d']]), { a: 1, b: 2, c: 2, d: 4 });
    assert.deepEqual(R.ranksOf([['a', 'b'], ['c']]), { a: 1, b: 1, c: 3 });
});

function miniState(n, cfg) {
    const s = game(n, cfg);
    s.stage = 'mini';
    s.turn = s.order.length;
    return s;
}

test('ödüller: 1. yıldız+silah, 2. silah, 3. kalkan, diğerleri boş', () => {
    const s = miniState(5);
    const r = R.applyMinigame(s, { ranking: [['p0'], ['p1'], ['p2'], ['p3'], ['p4']] }, ctx());
    assert.ok(r.ok);
    assert.equal(r.state.P.p0.s, 1);
    assert.equal(r.state.P.p0.w.length, 1);
    assert.equal(r.state.P.p1.s, 0);
    assert.equal(r.state.P.p1.w.length, 1);
    assert.deepEqual(r.state.P.p2.w, [], '3.: kalkan değil +25 can');
    assert.equal(r.state.P.p3.w.length, 0);
    assert.equal(r.state.P.p4.w.length, 0);
    assert.equal(r.state.rd, 2);
    assert.equal(r.state.stage, 'roll');
    assert.ok(Object.keys(r.state.chests).length >= 3, 'yeni sandıklar çıktı');
});

test('ödüller: eşit 1.ler ikisi de 1. ödülünü alır, sonraki 3. sayılır (+25 can)', () => {
    const s = miniState(3);
    s.P.p2.hp = 40;
    const r = R.applyMinigame(s, { ranking: [['p0', 'p1'], ['p2']] }, ctx());
    assert.equal(r.state.P.p0.s, 1);
    assert.equal(r.state.P.p1.s, 1);
    assert.equal(r.state.P.p2.hp, 65);
});

test('ödüller: düelloda kazanan 1., kaybeden 2. ödülünü alır; katılmayanlar bir şey almaz', () => {
    const s = miniState(4);
    const r = R.applyMinigame(s, { ranking: [['p2'], ['p3']] }, ctx());
    assert.equal(r.state.P.p2.s, 1);
    assert.equal(r.state.P.p2.w.length, 1);
    assert.equal(r.state.P.p3.s, 0);
    assert.equal(r.state.P.p3.w.length, 1);
    assert.equal(r.state.P.p0.w.length, 0);
    assert.equal(r.state.P.p1.w.length, 0);
});

test('ödüller: takım modunda yıldız bireye yazılır, takım havuzuna işler; dolu envanterde silah ödülü kaybolur', () => {
    const s = miniState(4, { mode: 'team' });
    s.P.p1.w = ['fist', 'fist', 'fist'];
    const r = R.applyMinigame(s, { ranking: [['p0'], ['p1'], ['p2']] }, ctx());
    assert.equal(R.teamStars(r.state, 0), 1);
    assert.equal(r.state.P.p1.w.length, 3);
    assert.ok(r.events.some((e) => e.t === 'lost' && e.id === 'p1'));
    const t = miniState(2);
    t.P.p0.w = ['fist', 'fist', 'fist'];
    const r2 = R.applyMinigame(t, { ranking: [['p0'], ['p1']] }, ctx());
    assert.ok(r2.events.some((e) => e.t === 'lost'));
    assert.equal(R.applyMinigame(game(2), { ranking: [] }, ctx()).ok, false, 'minioyun zamanı değil');
});

test('ödül yıldızı hedefe ulaştırırsa oyun biter', () => {
    const s = miniState(2, { goal: 3 });
    s.P.p0.s = 2;
    const r = R.applyMinigame(s, { ranking: [['p0'], ['p1']] }, ctx());
    assert.equal(r.state.stage, 'over');
    assert.deepEqual(r.state.winner, { kind: 'player', id: 'p0' });
});

// ---- Tur ve sıra akışı ----
test('tur akışı: herkes sırayla oynar, sonra minioyun evresi; atlayan oyuncu sırasını kaçırır', () => {
    let s = game(3);
    s.P.p1.sk = 1;
    const seen = [];
    for (let i = 0; i < 10 && s.stage !== 'mini'; i++) {
        const cur = R.current(s);
        seen.push(cur);
        let guard = 0;
        while (R.current(s) === cur && s.stage !== 'mini' && guard++ < 10) {
            s = apply(s, R.autoAction(s, ctx()), { dice: () => 1 }).state;
        }
    }
    assert.deepEqual(seen, ['p0', 'p2']);
    assert.equal(s.stage, 'mini');
    assert.equal(s.P.p1.sk, 0);
    const r = R.applyMinigame(s, { ranking: [['p0'], ['p1'], ['p2']] }, ctx());
    assert.equal(R.current(r.state), 'p1', 'ikinci turda sıra bir kaymış başlar');
    assert.equal(r.state.rd, 2);
});

test('autoAction: süre dolunca zar atılır, yön rastgele seçilir, silah kullanılmaz', () => {
    const s = game(2);
    assert.deepEqual(R.autoAction(s, ctx()), { type: 'roll', by: 'p0' });
    s.stage = 'choose'; s.choices = [4, 9]; s.steps = 2;
    const a = R.autoAction(s, ctx());
    assert.equal(a.type, 'dir');
    assert.ok([4, 9].includes(a.to));
    s.stage = 'act';
    assert.equal(R.autoAction(s, ctx()).type, 'end');
    s.stage = 'swap';
    assert.deepEqual(R.autoAction(s, ctx()), { type: 'swap', by: 'p0', drop: -1 });
});

test('bot: menzilde rakip varken (rastgele < 0.5) saldırır, değilse turu bitirir; takım arkadaşına saldırmaz', () => {
    const s = duelSetup('fist', 1);
    const yes = R.botAction(s, ctx({ rand: () => 0.1 }));
    assert.equal(yes.type, 'use');
    assert.equal(yes.target, 'p1');
    assert.equal(R.botAction(s, ctx({ rand: () => 0.9 })).type, 'end');
    const far = duelSetup('fist', 3);
    assert.equal(R.botAction(far, ctx({ rand: () => 0.1 })).type, 'end');
    const t = game(4, { mode: 'team' });
    t.P.p0.pos = loopNode.id; t.P.p1.pos = nodeAt(loopNode.id, 1); t.P.p2.pos = nodeAt(loopNode.id, 40) || 0;
    t.P.p0.w = ['fist']; t.stage = 'act';
    t.P.p2.pos = t.P.p3.pos = nodeAt(loopNode.id, 12);
    assert.equal(R.botAction(t, ctx({ rand: () => 0.1 })).type, 'end');
    const sh = game(2); sh.P.p0.w = ['shield']; sh.stage = 'act';
    assert.deepEqual(R.botAction(sh, ctx()), { type: 'use', by: 'p0', item: 0 });
});

test('removePlayer: sıradaki ayrılırsa sıra geçer; ikiden aza inerse oyun biter', () => {
    let s = game(3);
    let r = R.removePlayer(s, 'p0', ctx());
    assert.equal(R.current(r.state), 'p1');
    assert.equal(r.state.stage, 'roll');
    r = R.removePlayer(s, 'p2', ctx());
    assert.equal(R.current(r.state), 'p0');
    r = R.removePlayer(R.removePlayer(s, 'p2', ctx()).state, 'p1', ctx());
    assert.equal(r.state.stage, 'over');
    assert.deepEqual(r.state.winner, { kind: 'player', id: 'p0' });
});

test('forceskip: kopan oyuncunun turu geçilir', () => {
    const s = game(3);
    s.P.p0.offers = ['bow'];
    const r = apply(s, { type: 'forceskip' });
    assert.equal(R.current(r.state), 'p1');
    assert.deepEqual(r.state.P.p0.offers, []);
});

test('deterministik: aynı tohum aynı oyun; botlarla uçtan uca oyun biter', () => {
    function play(seed) {
        let st = R.createGame({ seed, cfg: { mode: 'solo', goal: 8, map: 'space' }, seats: seats(4) }, ctx({ g: G.index(require('../games/parti/maps/space.js')) }));
        const c = { g: G.index(require('../games/parti/maps/space.js')) };
        for (let i = 0; i < 4000 && st.stage !== 'over'; i++) {
            if (st.stage === 'mini') {
                const spec = R.minigameSpec(st, c);
                assert.ok(['ffa', 'duel'].includes(spec.type));
                st = R.applyMinigame(st, { ranking: [spec.players.slice()] }, c).state;
                continue;
            }
            const r = R.reduce(st, R.botAction(st, c), c);
            assert.ok(r.ok, r.error);
            st = r.state;
        }
        return st;
    }
    const a = play(11);
    assert.equal(a.stage, 'over');
    assert.deepEqual(JSON.stringify(a), JSON.stringify(play(11)));
    assert.notEqual(JSON.stringify(a), JSON.stringify(play(12)));
});

test('standings: bireysel ve takım sıralaması', () => {
    const s = game(4);
    s.P.p2.s = 7; s.P.p0.s = 7; s.P.p0.hp = 10; s.P.p1.s = 2;
    const st = R.standings(s);
    assert.equal(st[0].id, 'p2');
    assert.equal(st[1].id, 'p0');
    const t = game(4, { mode: 'team' });
    t.P.p0.s = 1; t.P.p1.s = 1; t.P.p2.s = 5;
    assert.deepEqual(R.standings(t).map((x) => [x.t, x.s]), [[1, 5], [0, 2]]);
});

test('tur başı sırası her turda bir kayar: 3 oyuncuda abc / bca / cab / abc; minioyun yalnız ödülleri etkiler', () => {
    let s = game(3);
    s.order = ['p0', 'p1', 'p2'];
    const starts = [];
    for (let round = 0; round < 4; round++) {
        starts.push(R.current(s));
        s.stage = 'mini';
        s.turn = s.order.length;
        // farklı minioyun sonuçları sırayı değiştirmez
        const ranking = round % 2 ? [['p2'], ['p1'], ['p0']] : [['p0'], ['p1'], ['p2']];
        s = R.applyMinigame(s, { ranking }, ctx()).state;
        s.chests = {};
    }
    assert.deepEqual(starts, ['p0', 'p1', 'p2', 'p0']);
    // bir turun tam sırası: ikinci turda b, c, a
    let t = game(3);
    t.order = ['p0', 'p1', 'p2'];
    t.stage = 'mini'; t.turn = 3;
    t = R.applyMinigame(t, { ranking: [['p0'], ['p1'], ['p2']] }, ctx()).state;
    assert.deepEqual(t.order, ['p1', 'p2', 'p0']);
    assert.equal(R.current(t), 'p1');
    // sıra kaydıktan sonra ayrılan oyuncu sırayı bozmaz
    const r = R.removePlayer(t, 'p2', ctx());
    assert.deepEqual(r.state.order, ['p1', 'p0']);
});

test('olay konumları: ölüm ve ışınlanma olayları eski kutucuğu (at) ve başlangıcı (to) taşır', () => {
    const s = duelSetup('fist', 1);
    s.P.p1.hp = 10; s.P.p1.s = 4;
    const r = apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' });
    const death = r.events.find((e) => e.t === 'death');
    assert.equal(death.at, s.P.p1.pos, 'ölüm eski kutucukta');
    assert.equal(death.to, s.P.p1.home);
    assert.equal(r.state.P.p1.pos, s.P.p1.home);
    // ışınlanma olayı (olay kutucuğu, weights: star3 damage3 teleport2 -> f=0.5)
    const t = game(2);
    const ev = pirate.nodes.find((n) => n.type === 'event');
    const pre = pirate.nodes.find((n) => n.next.length === 1 && n.next[0] === ev.id);
    t.P.p0.pos = pre.id;
    const r2 = apply(t, { type: 'roll', by: 'p0' }, { dice: () => 1, rand: () => 0.5 });
    const tp = r2.events.find((e) => e.t === 'event' && e.e === 'teleport');
    assert.ok(tp, 'ışınlanma çıktı');
    assert.equal(tp.at, ev.id);
    assert.equal(tp.to, t.P.p0.home);
    assert.equal(r2.state.P.p0.pos, t.P.p0.home);
});

test('attackOptions: bomba için atanın kendi kutucuğu sunulmaz (aynı kutucuktaki rakip olsa bile); kuralda insan yine atabilir', () => {
    const s = game(3);
    const a = loopNode.id;
    s.P.p0.pos = a; s.P.p1.pos = a; s.P.p2.pos = nodeAt(a, 2);
    s.P.p0.w = ['bomb']; s.stage = 'act';
    const opts = R.attackOptions(s, ctx());
    assert.ok(opts.length > 0, 'başka kutucuktaki rakip hâlâ hedef');
    assert.ok(opts.every((o) => o.node !== a), 'kendi kutucuğu yok');
    assert.ok(opts.some((o) => o.node === s.P.p2.pos));
    // yalnız aynı kutucukta rakip varsa bot hiç bomba seçeneği görmez
    s.P.p2.pos = a;
    assert.deepEqual(R.attackOptions(s, ctx()), []);
    // botAction kendini bombalamaz
    for (let i = 0; i < 20; i++) {
        const act = R.botAction(s, ctx({ rand: () => i / 20 }));
        assert.ok(!(act.type === 'use' && act.node === a));
    }
    // insan reduce ile yine kendi kutucuğuna atabilir (kural değişmedi)
    assert.equal(R.reduce(s, { type: 'use', by: 'p0', item: 0, node: a }, ctx()).ok, true);
});

test('prototip anahtarları ve geçersiz tipler hedef/düğüm/yön olarak reddedilir', () => {
    const s = duelSetup('fist', 1);
    for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 5, null, undefined, {}, [], 1.5]) {
        assert.equal(R.reduce(s, { type: 'use', by: 'p0', item: 0, target: bad }, ctx()).ok, false, 'target ' + String(bad));
    }
    const b = duelSetup('bomb', 1);
    for (const bad of ['__proto__', 'constructor', '0', -1, 1e9, 1.5, NaN, null, {}, []]) {
        assert.equal(R.reduce(b, { type: 'use', by: 'p0', item: 0, node: bad }, ctx()).ok, false, 'node ' + String(bad));
    }
    const c = game(2);
    c.stage = 'choose'; c.choices = [3, 4]; c.steps = 2;
    for (const bad of ['__proto__', 'constructor', '3', 3.5, null, {}, [3]]) {
        assert.equal(R.reduce(c, { type: 'dir', by: 'p0', to: bad }, ctx()).ok, false, 'to ' + String(bad));
    }
    // geçerli hâlâ çalışır
    assert.equal(R.reduce(duelSetup('fist', 1), { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok, true);
    assert.equal(R.reduce(duelSetup('bomb', 1), { type: 'use', by: 'p0', item: 0, node: loopNode.id }, ctx()).ok, true);
});

test('ölümde kayıp en çok 3 yıldız (min(3, floor(s/2))); 0-1 yıldızda kayıp yok', () => {
    for (const [stars, lost] of [[0, 0], [1, 0], [2, 1], [5, 2], [6, 3], [7, 3], [12, 3], [20, 3]]) {
        const s = duelSetup('fist', 1);
        s.P.p1.hp = 10; s.P.p1.s = stars; s.P.p0.s = 0;
        const r = apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' });
        assert.equal(r.state.P.p1.s, stars - lost, stars + ' yıldız');
        assert.equal(r.state.P.p0.s, lost);
    }
});

test('yıldız sandığı sayısı = ceil(n/2)+1 (2..8 oyuncu), silah sandığı 1; hazine noktalarına sığar', () => {
    for (let n = 2; n <= 8; n++) {
        const s = R.createGame({ seed: 9, cfg: { mode: 'solo', goal: 10, map: 'pirate' }, seats: seats(n) }, ctx());
        const chests = Object.values(s.chests);
        assert.equal(chests.filter((c) => c.k === 'star').length, Math.ceil(n / 2) + 1, n + ' oyuncu');
        assert.equal(chests.filter((c) => c.k === 'weapon').length, 1);
    }
    const space = require('../games/parti/maps/space.js');
    const gs = G.index(space);
    const s8 = R.createGame({ seed: 9, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats: seats(8) }, { g: gs });
    assert.equal(Object.keys(s8.chests).length, 6);
});

test('hedef otomatik (0): 2-3 oyuncuda 15, 4-8 oyuncuda 10; elle seçim korunur', () => {
    const mk = (n, goal) => R.createGame({ seed: 1, cfg: { mode: 'solo', goal, map: 'pirate' }, seats: seats(n) }, ctx()).goal;
    assert.deepEqual([2, 3, 4, 5, 8].map((n) => mk(n, 0)), [15, 15, 10, 10, 10]);
    assert.equal(mk(2, 5), 5);
    assert.equal(mk(8, 25), 25);
    assert.equal(C.autoGoal(3), 15);
    assert.equal(C.autoGoal(4), 10);
});

test('silah düşme ağırlıkları: yumruk 1, pompalı 3, yay 3, bomba 2, kalkan 2 (ağırlıklı)', () => {
    assert.deepEqual(C.WEAPON_WEIGHTS, { fist: 1, shotgun: 3, bow: 3, bomb: 2, shield: 2 });
    // ağırlık sınırları: f toplam(11) üzerinden
    const pick = (f) => {
        const s = game(2);
        s.chests = {};
        const treasure = pirate.nodes.find((n) => n.type === 'treasure').id;
        s.chests[treasure] = { k: 'weapon' };
        const pre = pirate.nodes.find((n) => n.next.length === 1 && n.next[0] === treasure);
        s.P.p0.pos = pre.id;
        const r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 1, rand: () => f });
        const ev = r.events.find((e) => e.t === 'chest' && e.k === 'weapon');
        return ev && ev.w;
    };
    assert.equal(pick(0.0), 'fist');            // [0,1)/11
    assert.equal(pick(0.5 / 11), 'fist');
    assert.equal(pick(2 / 11), 'shotgun');       // [1,4)
    assert.equal(pick(5 / 11), 'bow');           // [4,7)
    assert.equal(pick(8 / 11), 'bomb');          // [7,9)
    assert.equal(pick(10 / 11), 'shield');       // [9,11)
    // istatistik: 11000 çekim, her silah oranına yakın
    const counts = {};
    let seed = 7;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const st = { rs: 1 };
    for (let i = 0; i < 11000; i++) {
        const f = rnd();
        const s = game(2); s.chests = {};
        const treasure = pirate.nodes.find((n) => n.type === 'treasure').id;
        s.chests[treasure] = { k: 'weapon' };
        s.P.p0.pos = pirate.nodes.find((n) => n.next.length === 1 && n.next[0] === treasure).id;
        const r = R.reduce(s, { type: 'roll', by: 'p0' }, ctx({ dice: () => 1, rand: () => f }));
        const w = r.events.find((e) => e.t === 'chest' && e.k === 'weapon').w;
        counts[w] = (counts[w] || 0) + 1;
    }
    for (const [w, weight] of Object.entries(C.WEAPON_WEIGHTS)) assert.ok(Math.abs(counts[w] / 11000 - weight / 11) < 0.03, w + ' ' + counts[w]);
});

test('minioyun 3.\'lük ödülü: kalkan değil +25 can (üst sınır 100), olay üretir', () => {
    const s = miniState(4);
    s.P.p2.hp = 60;
    s.P.p3.hp = 90;
    let r = R.applyMinigame(s, { ranking: [['p0'], ['p1'], ['p2'], ['p3']] }, ctx());
    assert.equal(r.state.P.p2.hp, 85);
    assert.equal(r.state.P.p2.shield, false);
    assert.ok(!r.state.P.p2.w.includes('shield'));
    assert.ok(r.events.some((e) => e.t === 'heal' && e.id === 'p2' && e.n === 25));
    s.P.p2.hp = 90;
    r = R.applyMinigame(s, { ranking: [['p0'], ['p1'], ['p2']] }, ctx());
    assert.equal(r.state.P.p2.hp, 100, 'üst sınır');
    assert.ok(r.events.some((e) => e.t === 'heal' && e.id === 'p2' && e.n === 10));
    // eşit derece: [['p0','p1'],['p2']] -> p2 3. sayılır
    const t = miniState(3);
    t.P.p2.hp = 50;
    assert.equal(R.applyMinigame(t, { ranking: [['p0', 'p1'], ['p2']] }, ctx()).state.P.p2.hp, 75);
});

// ---- madde 10b: Son Çılgınlık ----
test('Son Çılgınlık: biri hedefe ≤3 ⭐ kalınca tur başında sandıklar ×2, olay yayımlanır; bir kez tetiklenir, sonra da ×2 sürer', () => {
    const s = miniState(2, { goal: 10 });
    s.P.p0.s = 7;                                    // 10 - 7 = 3 kala
    let r = R.applyMinigame(s, { ranking: [['p1'], ['p0']] }, ctx());
    assert.equal(r.state.fr, 1);
    assert.equal(r.events.filter((e) => e.t === 'frenzy').length, 1);
    let chests = Object.values(r.state.chests);
    assert.equal(chests.filter((c) => c.k === 'star').length, 2 * (Math.ceil(2 / 2) + 1), 'yıldız sandığı ×2');
    assert.equal(chests.filter((c) => c.k === 'weapon').length, 2, 'silah sandığı ×2');
    // sonraki tur: tekrar olay yok ama ×2 sürer
    const next = JSON.parse(JSON.stringify(r.state));
    next.chests = {};
    next.stage = 'mini'; next.turn = next.order.length;
    r = R.applyMinigame(next, { ranking: [['p0'], ['p1']] }, ctx());
    assert.equal(r.events.filter((e) => e.t === 'frenzy').length, 0, 'bir kez');
    assert.equal(Object.values(r.state.chests).filter((c) => c.k === 'star').length, 4);
});

test('Son Çılgınlık: 4 kala tetiklenmez; hedefe ulaşmış/geçmiş oyuncu için değil; 6 oyuncuda sandıklar hazine noktalarına sığar', () => {
    const far = miniState(2, { goal: 10 });
    far.P.p0.s = 6;                                  // 4 kala
    const r = R.applyMinigame(far, { ranking: [['p1'], ['p0']] }, ctx());
    assert.equal(r.state.fr, 0);
    assert.ok(!r.events.some((e) => e.t === 'frenzy'));
    assert.equal(Object.values(r.state.chests).filter((c) => c.k === 'star').length, 2);
    // yalnız ×2 hazine noktasını aşmaz
    const big = miniState(8, { goal: 10 });
    big.P.p3.s = 8;
    const rb = R.applyMinigame(big, { ranking: [['p0'], ['p1']] }, ctx());
    assert.equal(rb.state.fr, 1);
    const treasure = pirate.nodes.filter((n) => n.type === 'treasure').length;
    assert.ok(Object.keys(rb.state.chests).length <= treasure);
});

test('Son Çılgınlık: takım modunda takımın toplamı hedefe ≤3 kalınca tetiklenir', () => {
    const s = miniState(4, { mode: 'team', goal: 10 });
    s.P.p0.s = 4; s.P.p1.s = 3;                      // takım 0: 7 → 3 kala
    const r = R.applyMinigame(s, { ranking: [['p2'], ['p3']] }, ctx());
    assert.equal(r.state.fr, 1);
    const t = miniState(4, { mode: 'team', goal: 10 });
    t.P.p0.s = 6;                                    // tek oyuncu 6 ama takım 6 → 4 kala
    assert.equal(R.applyMinigame(t, { ranking: [['p2'], ['p3']] }, ctx()).state.fr, 0);
});
