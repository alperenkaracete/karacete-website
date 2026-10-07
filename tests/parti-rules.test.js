const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const G = require('../games/parti/graph.js');
const R = require('../games/parti/rules.js');
const pirate = require('../games/parti/maps/pirate.js');

const g = G.index(pirate);
// silah envanteri sayaç nesnesi: inv('fist', 'fist', 'bow') -> {fist: 2, bow: 1}
const inv = (...ids) => { const o = {}; ids.forEach((id) => { o[id] = (o[id] || 0) + 1; }); return o; };
const count = (p) => Object.values(p.w).reduce((a, b) => a + b, 0);

// Test kısayolu: use eylemlerinde `item: n` = eylemi yapan oyuncunun envanterindeki n. silah (sabit silah sırasıyla);
// üretim kodu yalnızca silah kimliğini (`w`) kabul eder.
function reduceT(state, action, c) {
    if (action && action.type === 'use' && action.item !== undefined && action.w === undefined) {
        const p = state.P[action.by];
        const list = [];
        C.WEAPON_IDS.forEach((w) => { for (let i = 0; i < ((p && p.w[w]) || 0); i++) list.push(w); });
        action = Object.assign({}, action, { w: list[action.item] });
        delete action.item;
    }
    return R.reduce(state, action, c);
}
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
    const r = reduceT(state, action, ctx(extra));
    assert.ok(r.ok, 'reddedildi: ' + r.error);
    return r;
}

// düğüm x'ten d adım uzaktaki (yönsüz) düğüm
function nodeAt(from, d, skip) {
    const dist = G.distances(g, from);
    return Object.keys(dist).map(Number).filter((n) => dist[n] === d && (!skip || !skip.includes(n)))[0];
}

const loopNode = pirate.nodes.find((n) => n.type === 'normal' && n.next.length === 1);

test('kurulum: herkes ortak başlangıçta, 100 can, 0 yıldız; ceil(n/2)+1 yıldız + 1 silah sandığı çıkar', () => {
    const s = R.createGame({ seed: 3, cfg: { mode: 'solo', goal: 10, map: 'pirate' }, seats: seats(8) }, ctx());
    const starts = new Set();
    s.order.forEach((id) => { starts.add(s.P[id].pos); assert.equal(s.P[id].hp, 100); assert.equal(s.P[id].s, 0); assert.equal(g.byId[s.P[id].pos].type, 'start'); });
    assert.equal(starts.size, 1, 'tüm oyuncular tek ortak başlangıç düğümünde');
    assert.equal(s.home, g.start);
    s.order.forEach((id) => assert.equal(s.P[id].home, g.start));
    const chests = Object.values(s.chests);
    assert.equal(chests.filter((c) => c.k === 'star').length, 5, '8 oyuncu: ceil(8/2)+1');
    assert.equal(chests.filter((c) => c.k === 'weapon').length, 1);
    Object.keys(s.chests).forEach((n) => assert.equal(g.byId[n].type, 'treasure'));
    assert.equal(s.stage, 'roll');
});

test('zar 1-6, adım adım yürür, varış düğümünde durur; yürüyüş bitince tur kendiliğinden biter', () => {
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
    assert.equal(R.current(r.state), 'p1', 'yürüyüş bitti: sıra sonraki oyuncuya geçti (act aşaması yok)');
    assert.equal(r.state.stage, 'roll');
    assert.equal(r.state.atk, 0, 'yeni turun saldırı hakkı sıfır');
});

test('sıra kimde değilse ya da evre yanlışsa eylem reddedilir', () => {
    const s = game(3);
    assert.equal(reduceT(s, { type: 'roll', by: 'p1' }, ctx()).ok, false);
    assert.equal(reduceT(s, { type: 'end', by: 'p0' }, ctx()).ok, false);
    assert.equal(reduceT(s, { type: 'dir', by: 'p0', to: 1 }, ctx()).ok, false);
    assert.equal(reduceT(s, { type: 'nope', by: 'p0' }, ctx()).ok, false);
    assert.equal(reduceT(s, null, ctx()).ok, false);
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
    assert.equal(reduceT(r.state, { type: 'dir', by: 'p0', to: -5 }, ctx()).ok, false);
    const r2 = apply(r.state, { type: 'dir', by: 'p0', to: branch.next[1] });
    assert.equal(r2.state.P.p0.pos === branch.id, false);
    assert.equal(r2.events.find((e) => e.t === 'move').path[0], branch.next[1]);
    assert.equal(R.current(r2.state), 'p1', 'yön seçilip yürüyüş bitince tur biter');
});

test('sandık: üzerinden geçen alır (yıldız), duran alır; envanter sınırında fazlası kaçar', () => {
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
    // envanter sınırı: tür başına ≤3 → fazlası "kaçtı" (seçim aşaması yok)
    const s3 = game(2);
    s3.P.p0.pos = a.id;
    s3.P.p0.w = inv('fist', 'fist', 'fist');
    s3.chests[mid] = { k: 'weapon' };
    r = apply(s3, { type: 'roll', by: 'p0' }, { dice: () => 2, rand: () => 0.0 });     // f=0 -> yumruk
    assert.ok(r.events.some((e) => e.t === 'lost' && e.id === 'p0' && e.w === 'fist'));
    assert.equal(r.state.P.p0.w.fist, 3);
});

test('sandık turun başında üstünde duran oyuncuya hemen verilir', () => {
    const s = game(2);
    const treasure = pirate.nodes.find((n) => n.type === 'treasure').id;
    s.P.p1.pos = treasure;
    for (let i = 0; i < 40; i++) {
        const t = JSON.parse(JSON.stringify(s));
        t.rs = i + 1;
        R.spawnChests(t, g, { f: () => 0.5, int: () => 0, pick: (a) => a[0], shuffle: (a) => a.slice() }, []);
        if (t.chests[treasure] === undefined && Object.keys(t.chests).length) { assert.ok(t.P.p1.s > 0 || count(t.P.p1) > 0); return; }
    }
});

// ---- Silahlar ----
function duelSetup(weapon, dist) {
    const s = game(2);
    const a = loopNode.id;
    const b = nodeAt(a, dist);
    s.P.p0.pos = a;
    s.P.p1.pos = b;
    s.P.p0.w = inv(weapon);
    s.stage = 'roll';
    return s;
}

test('yumruk: menzil 0-1 (aynı ya da komşu kutucuk), tek vuruş 100 hasar (öldürür); menzil dışı reddedilir; kalkan engeller', () => {
    for (const d of [0, 1]) {
        const s = duelSetup('fist', d);
        s.P.p1.s = 4;
        const r = apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' });
        assert.ok(r.events.some((e) => e.t === 'dmg' && e.id === 'p1' && e.n === 100), 'mesafe ' + d + ': 100 hasar');
        assert.ok(r.events.some((e) => e.t === 'death' && e.id === 'p1'), 'tek vuruşta ölür');
        assert.equal(r.state.P.p1.s, 2);
        assert.equal(count(r.state.P.p0), 0, 'tek atımlık');
        assert.equal(r.state.stage === 'act', false, 'saldırı turu bitirir');
    }
    const far = duelSetup('fist', 2);
    assert.equal(reduceT(far, { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok, false);
    const sh = duelSetup('fist', 1);
    sh.P.p1.shield = true;
    const rs = apply(sh, { type: 'use', by: 'p0', item: 0, target: 'p1' });
    assert.equal(rs.state.P.p1.hp, 100);
    assert.equal(rs.state.P.p1.shield, false);
    assert.ok(rs.events.some((e) => e.t === 'block') && !rs.events.some((e) => e.t === 'death'));
});

test('pompalı: 1/2/3 adımda 45/30/15; 4 adım menzil dışı (mesafe düşüşü)', () => {
    const want = { 1: 45, 2: 30, 3: 15 };
    for (const d of [1, 2, 3]) {
        const r = apply(duelSetup('shotgun', d), { type: 'use', by: 'p0', item: 0, target: 'p1' });
        assert.equal(100 - r.state.P.p1.hp, want[d], d + ' adım');
    }
    assert.equal(reduceT(duelSetup('shotgun', 4), { type: 'use', by: 'p0', w: 'shotgun', target: 'p1' }, ctx()).ok, false);
});

test('yay: menzil 5, hasar 20', () => {
    assert.equal(100 - apply(duelSetup('bow', 5), { type: 'use', by: 'p0', w: 'bow', target: 'p1' }).state.P.p1.hp, 20);
    assert.equal(reduceT(duelSetup('bow', 6), { type: 'use', by: 'p0', w: 'bow', target: 'p1' }, ctx()).ok, false);
});

test('bomba: seçilen kutucuktaki herkese (kendisi dahil) 30; menzil 4', () => {
    const s = game(4);
    const a = loopNode.id;
    const target = nodeAt(a, 2);
    s.P.p0.pos = a;
    s.P.p1.pos = target;
    s.P.p2.pos = target;
    s.P.p3.pos = nodeAt(a, 4);
    s.P.p0.w = inv('bomb');
    s.stage = 'roll';
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
    assert.equal(reduceT(s, { type: 'use', by: 'p0', item: 0, node: nodeAt(a, 5) }, ctx()).ok, false);
});

test('kalkan: kurmak turun saldırı hakkını harcar (zardan önce), ardından zar atılabilir; saldırıyı engeller ve tükenir; ikinci kez kurulamaz', () => {
    const s = duelSetup('fist', 1);
    s.P.p1.w = inv('shield', 'shield');
    const t = JSON.parse(JSON.stringify(s));
    t.turn = 1; t.stage = 'roll'; t.atk = 0;
    let r = apply(t, { type: 'use', by: 'p1', item: 0 });
    assert.equal(r.state.P.p1.shield, true);
    assert.equal(r.state.atk, 1, 'saldırı hakkı harcandı');
    assert.equal(r.state.stage, 'roll', 'zar atılabilir');
    assert.equal(R.current(r.state), 'p1', 'tur bitmedi');
    assert.equal(count(r.state.P.p1), 1);
    assert.equal(reduceT(r.state, { type: 'use', by: 'p1', item: 0 }, ctx()).ok, false, 'saldırı hakkı yok / zaten kalkan var');
    assert.ok(reduceT(r.state, { type: 'roll', by: 'p1' }, ctx()).ok, 'kalkandan sonra zar');
    // saldırı engellenir
    const u = JSON.parse(JSON.stringify(r.state));
    u.turn = 0; u.atk = 0;
    r = apply(u, { type: 'use', by: 'p0', item: 0, target: 'p1' });
    assert.equal(r.state.P.p1.hp, 100);
    assert.equal(r.state.P.p1.shield, false);
    assert.ok(r.events.some((e) => e.t === 'block'));
    assert.equal(count(r.state.P.p0), 0, 'silah yine de harcandı');
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
    s.P.p1.w = inv('bow');
    s.P.p0.s = 1;
    const r = apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' });
    assert.equal(r.state.P.p1.s, 3, '5 yıldız: floor(5/2)=2 kaybolur');
    assert.equal(r.state.P.p0.s, 3);
    assert.equal(r.state.P.p1.hp, 100);
    assert.equal(r.state.P.p1.pos, s.P.p1.home);
    assert.equal(r.state.P.p1.sk, 0, 'ölümde tur atlatma yok');
    assert.ok(!r.events.some((e) => e.t === 'skip'));
    assert.equal(r.state.stage, 'roll', 'saldıran zar atabilir (silah turu bitirmez)');
    assert.equal(R.current(r.state), 'p0');
    assert.equal(r.state.atk, 1);
    // ölen oyuncu bir sonraki turunda normal oynar (atlanmaz)
    const nextRound = JSON.parse(JSON.stringify(r.state));
    nextRound.stage = 'mini'; nextRound.turn = nextRound.order.length;
    const afterMini = R.applyMinigame(nextRound, { ranking: [['p0'], ['p1']] }, ctx()).state;
    const played = new Set();
    let st = afterMini;
    for (let i = 0; i < 12 && st.stage !== 'mini'; i++) { played.add(R.current(st)); st = apply(st, R.autoAction(st, ctx()), { dice: () => 1 }).state; }
    assert.deepEqual([...played].sort(), ['p0', 'p1'], 'ölen de oynar');
    assert.deepEqual(r.state.P.p1.w, { bow: 1 });
    assert.ok(r.events.some((e) => e.t === 'death' && e.id === 'p1' && e.killer === 'p0' && e.lost === 2));
});

test('ölüm: bomba/çoklu hedefte en çok hasar veren yıldızları alır; kendi bombasıyla ölenin yıldızı kimseye gitmez', () => {
    const s = game(3);
    const a = loopNode.id;
    s.P.p2.pos = a; s.P.p2.hp = 30; s.P.p2.s = 6;
    s.P.p2.dmg = { p0: 10, p1: 50 };            // önceki saldırılar
    s.P.p0.pos = nodeAt(a, 1);
    s.P.p0.w = inv('bomb');
    s.stage = 'roll';
    let r = apply(s, { type: 'use', by: 'p0', item: 0, node: a });
    assert.equal(r.state.P.p2.s, 3);
    assert.equal(r.state.P.p1.s, 3, 'en çok hasar veren p1');
    assert.equal(r.state.P.p0.s, 0);
    const t = game(2);
    t.P.p0.pos = loopNode.id; t.P.p0.hp = 20; t.P.p0.s = 4; t.P.p0.w = inv('bomb'); t.stage = 'roll';
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
    s.P.p0.w = inv('fist', 'bomb');
    s.stage = 'roll';
    assert.equal(reduceT(s, { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok, false);
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
    assert.equal(reduceT(r.state, { type: 'roll', by: 'p0' }, ctx()).ok, false);
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
    t.turn = 2; t.stage = 'roll'; t.P.p2.w = inv('fist');
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
    assert.equal(count(r.state.P.p0), 1);
    assert.equal(r.state.P.p1.s, 0);
    assert.equal(count(r.state.P.p1), 1);
    assert.deepEqual(r.state.P.p2.w, {}, '3.: kalkan değil +25 can');
    assert.equal(count(r.state.P.p3), 0);
    assert.equal(count(r.state.P.p4), 0);
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

test('teselli: düelloda olmayanlar +25 can alır (üst sınır 100); düellocular almaz; 3. derece ödülüyle çakışmaz', () => {
    const s = miniState(5);
    s.P.p0.hp = 30; s.P.p1.hp = 30; s.P.p2.hp = 90; s.P.p3.hp = 100; s.P.p4.hp = 10;
    const r = R.applyMinigame(s, { ranking: [['p0'], ['p1']] }, ctx());     // düello: p0 1., p1 2.
    assert.equal(r.state.P.p0.hp, 30, 'kazanan teselli almaz');
    assert.equal(r.state.P.p1.hp, 30, 'kaybeden teselli almaz');
    assert.equal(r.state.P.p2.hp, 100, 'üst sınır 100');
    assert.equal(r.state.P.p3.hp, 100);
    assert.equal(r.state.P.p4.hp, 35);
    const heals = r.events.filter((e) => e.t === 'heal');
    assert.deepEqual(heals.map((e) => [e.id, e.n]).sort(), [['p2', 10], ['p4', 25]], 'tam canlıya olay yok');
    // düello sıralamasında 3. derece yok: kimse hem 3. ödülü hem tesellisini almaz
    assert.deepEqual(r.events.filter((e) => e.t === 'reward').map((e) => e.rank).sort(), [1, 2]);
});

test('teselli: ffa\'da herkes sıralıdır, teselli yok; beraberlikte ([[a,b]]) diğerleri teselli alır', () => {
    const s = miniState(4);
    s.P.p0.hp = 50; s.P.p1.hp = 50; s.P.p2.hp = 50; s.P.p3.hp = 50;
    const r = R.applyMinigame(s, { ranking: [['p0'], ['p1'], ['p2'], ['p3']] }, ctx());
    assert.equal(r.state.P.p3.hp, 50, 'ffa 4.: ödül yok, teselli yok');
    assert.equal(r.state.P.p2.hp, 75, 'ffa 3.: yalnız 3. derece ödülü (+25), çift değil');
    const d = R.applyMinigame(s, { ranking: [['p0', 'p1']] }, ctx());
    assert.equal(d.state.P.p2.hp, 75);
    assert.equal(d.state.P.p3.hp, 75);
    assert.equal(d.state.P.p0.hp, 50);
});

test('ödüller: düelloda kazanan 1., kaybeden 2. ödülünü alır; katılmayanlar bir şey almaz', () => {
    const s = miniState(4);
    const r = R.applyMinigame(s, { ranking: [['p2'], ['p3']] }, ctx());
    assert.equal(r.state.P.p2.s, 1);
    assert.equal(count(r.state.P.p2), 1);
    assert.equal(r.state.P.p3.s, 0);
    assert.equal(count(r.state.P.p3), 1);
    assert.equal(count(r.state.P.p0), 0);
    assert.equal(count(r.state.P.p1), 0);
});

test('ödüller: takım modunda yıldız bireye yazılır, takım havuzuna işler; dolu envanterde silah ödülü kaybolur', () => {
    const s = miniState(4, { mode: 'team' });
    s.P.p1.w = inv('fist', 'fist', 'fist', 'bow', 'bow', 'bow');          // toplam 6: dolu
    const r = R.applyMinigame(s, { ranking: [['p0'], ['p1'], ['p2']] }, ctx());
    assert.equal(R.teamStars(r.state, 0), 1);
    assert.equal(count(r.state.P.p1), 6);
    assert.ok(r.events.some((e) => e.t === 'lost' && e.id === 'p1'));
    const t = miniState(2);
    t.P.p0.w = inv('fist', 'fist', 'fist', 'bow', 'bow', 'bow');
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
    s.stage = 'roll';
    assert.equal(R.autoAction(s, ctx()).type, 'roll', 'süre dolunca silah kullanılmaz, zar atılır');
});

test('bot: menzilde rakip varken (rastgele < 0.5) saldırır, değilse turu bitirir; takım arkadaşına saldırmaz', () => {
    const s = duelSetup('fist', 1);
    const yes = R.botAction(s, ctx({ rand: () => 0.1 }));
    assert.equal(yes.type, 'use');
    assert.equal(yes.target, 'p1');
    assert.equal(R.botAction(s, ctx({ rand: () => 0.9 })).type, 'roll');
    const far = duelSetup('fist', 3);
    assert.equal(R.botAction(far, ctx({ rand: () => 0.1 })).type, 'roll');
    const t = game(4, { mode: 'team' });
    t.P.p0.pos = loopNode.id; t.P.p1.pos = nodeAt(loopNode.id, 1); t.P.p2.pos = nodeAt(loopNode.id, 40) || 0;
    t.P.p0.w = inv('fist'); t.stage = 'roll';
    t.P.p2.pos = t.P.p3.pos = nodeAt(loopNode.id, 12);
    assert.equal(R.botAction(t, ctx({ rand: () => 0.1 })).type, 'roll');
    const sh = game(2); sh.P.p0.w = inv('shield'); sh.stage = 'roll';
    sh.P.p0.pos = loopNode.id; sh.P.p1.pos = nodeAt(loopNode.id, 2);
    assert.deepEqual(R.botAction(sh, ctx()), { type: 'use', by: 'p0', w: 'shield' }, 'yakında rakip + kalkan: kurar');
    sh.P.p1.pos = nodeAt(loopNode.id, 6);
    assert.equal(R.botAction(sh, ctx()).type, 'roll', 'rakip yakında değil: zar');
    sh.P.p1.pos = sh.home;
    assert.equal(R.botAction(sh, ctx()).type, 'roll', 'rakip güvenli bölgede: kalkan kurmaz');
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
    const r = apply(s, { type: 'forceskip' });
    assert.equal(R.current(r.state), 'p1');
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
            const r = reduceT(st, R.botAction(st, c), c);
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
    s.P.p0.w = inv('bomb'); s.stage = 'roll';
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
    assert.equal(reduceT(s, { type: 'use', by: 'p0', item: 0, node: a }, ctx()).ok, true);
});

test('prototip anahtarları ve geçersiz tipler hedef/düğüm/yön olarak reddedilir', () => {
    const s = duelSetup('fist', 1);
    for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 5, null, undefined, {}, [], 1.5]) {
        assert.equal(reduceT(s, { type: 'use', by: 'p0', item: 0, target: bad }, ctx()).ok, false, 'target ' + String(bad));
    }
    const b = duelSetup('bomb', 1);
    for (const bad of ['__proto__', 'constructor', '0', -1, 1e9, 1.5, NaN, null, {}, []]) {
        assert.equal(reduceT(b, { type: 'use', by: 'p0', item: 0, node: bad }, ctx()).ok, false, 'node ' + String(bad));
    }
    const c = game(2);
    c.stage = 'choose'; c.choices = [3, 4]; c.steps = 2;
    for (const bad of ['__proto__', 'constructor', '3', 3.5, null, {}, [3]]) {
        assert.equal(reduceT(c, { type: 'dir', by: 'p0', to: bad }, ctx()).ok, false, 'to ' + String(bad));
    }
    // geçerli hâlâ çalışır
    assert.equal(reduceT(duelSetup('fist', 1), { type: 'use', by: 'p0', w: 'fist', target: 'p1' }, ctx()).ok, true);
    assert.equal(reduceT(duelSetup('bomb', 1), { type: 'use', by: 'p0', w: 'bomb', node: loopNode.id }, ctx()).ok, true);
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
        const r = reduceT(s, { type: 'roll', by: 'p0' }, ctx({ dice: () => 1, rand: () => f }));
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
    assert.ok(!r.state.P.p2.w.shield);
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

// ---- acil hata: aynı kutucukta saldırı (mesafe 0) NaN üretmemeli ----
test('aynı kutucukta (mesafe 0) yumruk/pompalı/yay vurur: can düşer, NaN yok', () => {
    const want = { fist: 100, shotgun: 45, bow: 20 };
    for (const w of ['fist', 'shotgun', 'bow']) {
        const s = duelSetup(w, 0);
        assert.equal(s.P.p0.pos, s.P.p1.pos);
        const r = apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' });
        if (w === 'fist') assert.ok(r.events.some((e) => e.t === 'death' && e.id === 'p1'), 'yumruk 100: öldürür');
        else assert.equal(r.state.P.p1.hp, 100 - want[w], w);
        assert.ok(Number.isFinite(r.state.P.p1.hp));
        const dmgEv = r.events.find((e) => e.t === 'dmg');
        assert.ok(dmgEv && Number.isFinite(dmgEv.n) && dmgEv.n === want[w], 'olay hasarı sonlu');
    }
});

test('aynı kutucukta hasar 0\'da ölümle biter (NaN ölümsüzlük yok); botlar da saldırır', () => {
    for (const w of ['fist', 'shotgun', 'bow']) {
        const s = duelSetup(w, 0);
        s.P.p1.hp = 10; s.P.p1.s = 4;
        const r = apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' });
        assert.ok(r.events.some((e) => e.t === 'death' && e.id === 'p1'), w + ' öldürdü');
        assert.equal(r.state.P.p1.hp, 100, 'öldükten sonra can dolar');
    }
    const s = duelSetup('fist', 0);
    const opts = R.attackOptions(s, ctx());
    assert.ok(opts.some((o) => o.target === 'p1'), 'aynı kutucuktaki hedef sunulur');
    const act = R.botAction(s, ctx({ rand: () => 0.1 }));
    assert.equal(act.type, 'use');
    assert.equal(act.target, 'p1');
    const r = apply(s, act);
    assert.ok(Number.isFinite(r.state.P.p1.hp));
    assert.ok(r.events.some((e) => e.t === 'dmg' && e.id === 'p1'), 'bot aynı kutucuktakine vurdu');
});

test('hit güvenliği: geçersiz hasar yok sayılır, bozuk (NaN) can onarılır; weaponDamage mesafe 0 = mesafe 1', () => {
    const s = duelSetup('fist', 0);
    s.P.p1.hp = NaN;
    const r = apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' });
    assert.ok(Number.isFinite(r.state.P.p1.hp), 'NaN can onarıldı');
    assert.ok(r.state.P.p1.hp <= 100);
    // doğrudan reduce ile bozuk tablo: hasar tanımsız menzilde reddedilir
    const bad = duelSetup('fist', 0);
    const original = C.WEAPONS.fist.dmg;
    C.WEAPONS.fist.dmg = {};
    try {
        assert.equal(reduceT(bad, { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok, false);
    } finally { C.WEAPONS.fist.dmg = original; }
    for (const [w, d1] of [['fist', 100], ['shotgun', 45], ['bow', 20]]) {
        const a = apply(duelSetup(w, 0), { type: 'use', by: 'p0', item: 0, target: 'p1' });
        const b = apply(duelSetup(w, 1), { type: 'use', by: 'p0', item: 0, target: 'p1' });
        const dmgOf = (r) => r.events.find((e) => e.t === 'dmg').n;
        assert.equal(dmgOf(a), d1, w + ' mesafe 0');
        assert.equal(dmgOf(b), d1, w + ' mesafe 1');
    }
});

test('özellik testi: 300 rastgele hamlede (aynı kutucuk dahil) tüm can/yıldız değerleri sonlu tamsayı', () => {
    let seed = 99;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let st = R.createGame({ seed: 5, cfg: { mode: 'solo', goal: 25, map: 'pirate' }, seats: seats(4) }, ctx());
    const nodes = pirate.nodes.filter((n) => n.type !== 'start').slice(0, 3).map((n) => n.id);
    let attacks = 0;
    for (let i = 0; i < 300; i++) {
        if (st.stage === 'over') break;
        if (st.stage === 'mini') { st = R.applyMinigame(st, { ranking: [st.order.slice()] }, ctx()).state; continue; }
        // oyuncuları dar bir bölgede topla (sık aynı kutucuk) ve silah ver
        if (st.stage !== 'choose' && rnd() < 0.8) st.order.forEach((pid) => { st.P[pid].pos = nodes[Math.floor(rnd() * nodes.length)]; });      // sık aynı kutucuk
        const cur = R.current(st);
        if (count(st.P[cur]) < 6 && rnd() < 0.5) { const wid = C.WEAPON_IDS[Math.floor(rnd() * 4)]; if ((st.P[cur].w[wid] || 0) < 3) st.P[cur].w[wid] = (st.P[cur].w[wid] || 0) + 1; }
        let act;
        const opts = st.stage === 'roll' ? R.attackOptions(st, ctx()) : [];
        if (opts.length && rnd() < 0.7) { act = opts[Math.floor(rnd() * opts.length)]; attacks++; }
        else act = R.botAction(st, ctx({ rand: rnd }));
        const r = reduceT(st, act, ctx({ rand: rnd }));
        if (r.ok) st = r.state;
        for (const id of st.order) {
            const p = st.P[id];
            assert.ok(Number.isFinite(p.hp) && Number.isInteger(p.hp) && p.hp > 0 && p.hp <= 100, 'hp ' + p.hp + ' adım ' + i);
            assert.ok(Number.isInteger(p.s) && p.s >= 0, 'yıldız');
        }
        r.events.forEach((e) => { if (e.t === 'dmg') assert.ok(Number.isFinite(e.n) && e.n > 0); });
    }
    assert.ok(attacks > 20, 'yeterince saldırı denendi: ' + attacks);
});

// ---- olay kutucuğu: ❓ simgesi, spiker yazıları, olasılıklar ----
test('olay olasılıkları config ağırlıklarından üretilir; toplam tam %100, oranlar ağırlıkla orantılı', () => {
    const odds = C.eventOdds();
    assert.equal(odds.length, C.EVENTS.length);
    assert.equal(odds.reduce((a, o) => a + o.pct, 0), 100);
    const total = C.EVENTS.reduce((a, e) => a + e.weight, 0);
    odds.forEach((o) => {
        const ev = C.EVENTS.find((e) => e.id === o.id);
        assert.ok(Math.abs(o.pct - 100 * ev.weight / total) < 1, o.id + ' ' + o.pct);
        assert.ok(o.icon && o.label);
    });
    // ağırlığı değiştirince olasılık değişir (tablodan türer)
    const saved = C.EVENTS[0].weight;
    C.EVENTS[0].weight = 100;
    try { assert.ok(C.eventOdds()[0].pct > 85); } finally { C.EVENTS[0].weight = saved; }
});

test('her olay için spiker yazısı ve günlük metni var; ad yerine konur; 🎁 yalnızca silah olayında', () => {
    assert.equal(C.NODE_TYPES.event.icon, '❓');
    assert.notEqual(C.NODE_TYPES.weapon.icon, '🎁');
    for (const ev of C.EVENTS) {
        const text = C.eventAnnounce(ev.id, 'Ayşe');
        assert.ok(text && text.includes('Ayşe') && !text.includes('{name}'), ev.id);
        assert.ok(ev.text && ev.icon && ev.label);
        if (ev.icon === '🎁') assert.equal(ev.id, 'weapon');
    }
    assert.equal(C.eventAnnounce('yok', 'x'), null);
    assert.match(C.eventAnnounce('star', 'Ali'), /\+1/);
    assert.match(C.eventAnnounce('damage', 'Ali'), /−15/);
});

test('olay kutucuğu sonuçları: her olay türü bir olay üretir (yıldız, tuzak −15, ışınlanma, silah, dinlenme)', () => {
    const ev = pirate.nodes.find((n) => n.type === 'event');
    const pre = pirate.nodes.find((n) => n.next.length === 1 && n.next[0] === ev.id);
    const total = C.EVENTS.reduce((a, e) => a + e.weight, 0);
    let acc = 0;
    const seen = new Set();
    for (const e of C.EVENTS) {
        const f = (acc + e.weight / 2) / total;      // bu olayın ağırlık aralığının ortası
        acc += e.weight;
        const s = game(2);
        s.chests = {};
        s.P.p0.pos = pre.id;
        const r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 1, rand: () => f });
        const got = r.events.find((x) => x.t === 'event');
        assert.equal(got.e, e.id);
        seen.add(got.e);
        if (e.id === 'star') assert.equal(r.state.P.p0.s, 1);
        if (e.id === 'damage') assert.equal(r.state.P.p0.hp, 85);
        if (e.id === 'teleport') assert.equal(r.state.P.p0.pos, r.state.P.p0.home);
        if (e.id === 'rest') assert.equal(r.state.P.p0.sk, 1);
    }
    assert.equal(seen.size, C.EVENTS.length);
});


// ---- ortak başlangıç: güvenli bölge ----
function startSetup(weapon, victimPos) {
    const s = game(3);
    const a = loopNode.id;
    s.P.p0.pos = a;
    s.P.p1.pos = victimPos;
    s.P.p0.w = inv(weapon);
    s.stage = 'roll';
    return s;
}

test('tüm oyuncular tek başlangıçtan başlar; ölünce de oraya döner (home)', () => {
    const spaceMap = require('../games/parti/maps/space.js');
    const gs = G.index(spaceMap);
    const s = R.createGame({ seed: 4, cfg: { mode: 'solo', goal: 10, map: 'space' }, seats: seats(8) }, { g: gs });
    assert.equal(new Set(s.order.map((id) => s.P[id].pos)).size, 1);
    assert.equal(s.P[s.order[0]].pos, gs.start);
    const d = duelSetup('fist', 0);
    d.P.p1.hp = 10;
    const r = apply(d, { type: 'use', by: 'p0', item: 0, target: 'p1' });
    assert.ok(r.events.some((e) => e.t === 'death' && e.id === 'p1'));
    assert.equal(r.state.P.p1.pos, r.state.home, 'ölen ortak başlangıca döndü');
    assert.equal(r.state.home, g.start);
});

test('güvenli bölge: başlangıçtaki oyuncu hasar almaz; hedef sunulmaz; her silah/bomba reddeder', () => {
    for (const w of ['fist', 'shotgun', 'bow']) {
        const s = startSetup(w, g.start);
        s.P.p0.pos = nodeAt(g.start, w === 'fist' ? 1 : 1, [g.start]);
        const res = reduceT(s, { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx());
        assert.equal(res.ok, false, w + ' başlangıçtakine vuramaz');
        assert.ok(!R.attackOptions(s, ctx()).some((o) => o.target === 'p1'), w + ': hedef sunulmaz');
    }
    // bomba: başlangıç kutucuğu hedef olamaz; yakındaki kutuculara atılırsa başlangıçtakiler etkilenmez
    const b = startSetup('bomb', g.start);
    b.P.p0.pos = nodeAt(g.start, 1, [g.start]);
    assert.equal(reduceT(b, { type: 'use', by: 'p0', item: 0, node: g.start }, ctx()).ok, false);
    assert.ok(!R.attackOptions(b, ctx()).some((o) => o.node === g.start));
    // hit() doğrudan: başlangıçtaki hasar almaz, kalkanı da harcanmaz
    const s2 = game(2);
    s2.P.p1.shield = true;
    s2.P.p1.pos = g.start;
    const ev = [];
    // olay hasarı (tuzak) bile başlangıçta etkisizdir: dolaylı test için bomba komşu kutucuğa
    const bomb = startSetup('bomb', nodeAt(g.start, 1, [g.start]));
    bomb.P.p0.pos = nodeAt(g.start, 2, [g.start]);
    bomb.P.p2.pos = g.start;
    bomb.P.p2.shield = true;
    const r = apply(bomb, { type: 'use', by: 'p0', item: 0, node: bomb.P.p1.pos });
    assert.equal(r.state.P.p2.hp, 100);
    assert.equal(r.state.P.p2.shield, true, 'güvenli bölgedeki kalkan harcanmadı');
    assert.ok(ev.length === 0);
});

test('başlangıçtan çıkınca hasar alınır (güvenli bölge yalnızca başlangıç düğümünde)', () => {
    const s = startSetup('bow', 0);
    const next = nodeAt(g.start, 1, [g.start]);
    s.P.p0.pos = next; s.P.p1.pos = next;
    assert.equal(apply(s, { type: 'use', by: 'p0', item: 0, target: 'p1' }).state.P.p1.hp, 80);
});

test('başlangıç düğümünden en az 2 dal çıkar: ilk hamle yön seçtirir', () => {
    const st = game(2);
    assert.ok(g.byId[g.start].next.length >= 2);
    const r = apply(st, { type: 'roll', by: 'p0' }, { dice: () => 3 });
    assert.equal(r.state.stage, 'choose');
    assert.equal(r.state.P.p0.pos, g.start);
    assert.deepEqual(r.state.choices, g.byId[g.start].next);
});

test('eski anlık görüntü uyumu: createGame home alanları geçerli (p.home = g.start)', () => {
    const s = R.createGame({ seed: 1, cfg: { mode: 'solo', goal: 10, map: 'pirate' }, seats: seats(3) }, ctx());
    s.order.forEach((id) => assert.equal(s.P[id].home, s.home));
});

// ---- sayaçlı envanter: sınırlar ----
function zoneRoll(inventory, f) {
    const zone = pirate.nodes.find((n) => n.type === 'weapon');
    const pre = pirate.nodes.find((n) => n.next.length === 1 && n.next[0] === zone.id);
    const s = game(2);
    s.chests = {};
    s.P.p0.pos = pre.id;
    s.P.p0.w = inventory;
    return apply(s, { type: 'roll', by: 'p0' }, { dice: () => 1, rand: () => f });
}

test('envanter: sayaç artar (×2), tür başına en çok 3, fazlası kaçar', () => {
    let r = zoneRoll(inv('fist'), 0.0);                       // yumruk geldi
    assert.equal(r.state.P.p0.w.fist, 2);
    assert.ok(r.events.some((e) => e.t === 'item' && e.w === 'fist'));
    r = zoneRoll(inv('fist', 'fist'), 0.0);
    assert.equal(r.state.P.p0.w.fist, 3);
    r = zoneRoll(inv('fist', 'fist', 'fist'), 0.0);
    assert.equal(r.state.P.p0.w.fist, 3, 'tür sınırı');
    assert.ok(r.events.some((e) => e.t === 'lost' && e.w === 'fist'));
});

test('envanter: toplam en çok 6; dolu envanterde her tür kaçar', () => {
    const full = inv('fist', 'fist', 'fist', 'bow', 'bow', 'bow');
    for (const f of [0.0, 2 / 11, 5 / 11, 8 / 11, 10 / 11]) {
        const r = zoneRoll(Object.assign({}, full), f);
        assert.ok(r.events.some((e) => e.t === 'lost' && e.id === 'p0'), 'f=' + f);
        assert.equal(count(r.state.P.p0), 6);
    }
    const five = inv('fist', 'fist', 'fist', 'bow', 'bow');
    const r2 = zoneRoll(five, 2 / 11);                      // pompalı: 6. öğe sığar
    assert.equal(count(r2.state.P.p0), 6);
    assert.equal(r2.state.P.p0.w.shotgun, 1);
});

test('envanter: kalkan en çok 1; ikinci kalkan kaçar', () => {
    const r = zoneRoll(inv('shield'), 10 / 11);               // kalkan düştü
    assert.equal(r.state.P.p0.w.shield, 1);
    assert.ok(r.events.some((e) => e.t === 'lost' && e.w === 'shield'));
    const r2 = zoneRoll({}, 10 / 11);
    assert.equal(r2.state.P.p0.w.shield, 1);
});

test('use silah kimliğiyle çalışır: sayaç azalır, 0 olunca anahtar silinir; envanterde olmayan/geçersiz kimlik reddedilir', () => {
    const s = duelSetup('fist', 1);
    s.P.p0.w = inv('fist', 'fist', 'bow');
    s.P.p1.s = 0;
    const r = apply(s, { type: 'use', by: 'p0', w: 'bow', target: 'p1' });
    assert.deepEqual(r.state.P.p0.w, { fist: 2 }, 'bow bitti, anahtar silindi');
    for (const bad of ['laser', 'shotgun', '__proto__', 'constructor', 5, null, undefined, {}]) {
        assert.equal(R.reduce(s, { type: 'use', by: 'p0', w: bad, target: 'p1' }, ctx()).ok, false, String(bad));
    }
    // swap eylemi artık yok
    assert.equal(R.reduce(s, { type: 'swap', by: 'p0', drop: 0 }, ctx()).ok, false);
});

test('rules: kabul edilen her eylem state.rev artırır; reddedilen artırmaz', () => {
    const s = game(2);
    const r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 1 });
    assert.equal(r.state.rev, s.rev + 1);
    const bad = R.reduce(s, { type: 'dir', by: 'p0', to: 1 }, ctx());
    assert.equal(bad.ok, false);
    assert.equal(bad.state.rev, s.rev);
    const m = miniState(2);
    assert.equal(R.applyMinigame(m, { ranking: [['p0'], ['p1']] }, ctx()).state.rev, m.rev + 1);
    assert.equal(R.removePlayer(game(3), 'p2', ctx()).state.rev, game(3).rev + 1);
});

// ---- zardan önce saldırı ----
test('silah yalnızca roll aşamasında (zardan önce) kullanılır; choose aşamasında ve yürüyüşten sonra reddedilir', () => {
    const s = duelSetup('bow', 2);
    assert.equal(s.stage, 'roll');
    assert.ok(reduceT(s, { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok);
    const c = JSON.parse(JSON.stringify(s));
    c.stage = 'choose'; c.choices = [1, 2]; c.steps = 2;
    assert.equal(reduceT(c, { type: 'use', by: 'p0', item: 0, target: 'p1' }, ctx()).ok, false, 'yön seçerken silah yok');
    assert.equal(R.attackOptions(c, ctx()).length, 0, 'choose aşamasında seçenek sunulmaz');
    // act aşaması yok: yürüyüş sonrası sıra ilerler, saldırı yeni turun başında
    const r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 1 });
    assert.equal(R.current(r.state), 'p1');
    assert.equal(reduceT(r.state, { type: 'end', by: 'p1' }, ctx()).ok, false, "'end' eylemi kalktı");
});

test('turda tek saldırı hakkı: silah turu bitirmez, ikinci silah reddedilir, zar serbest; yeni turda hak yenilenir', () => {
    const s = duelSetup('bow', 2);
    s.P.p0.w = inv('bow', 'bow', 'fist');
    const r = apply(s, { type: 'use', by: 'p0', w: 'bow', target: 'p1' });
    assert.equal(R.current(r.state), 'p0', 'tur bitmedi');
    assert.equal(r.state.stage, 'roll');
    assert.equal(r.state.atk, 1);
    assert.equal(reduceT(r.state, { type: 'use', by: 'p0', w: 'bow', target: 'p1' }, ctx()).ok, false, 'ikinci silah yok');
    assert.deepEqual(R.attackOptions(r.state, ctx()), [], 'saldırı seçeneği kalmaz');
    assert.equal(R.botAction(r.state, ctx({ rand: () => 0.0 })).type, 'roll', 'bot ikinci kez saldırmaz, zar atar');
    const r2 = apply(r.state, { type: 'roll', by: 'p0' }, { dice: () => 1 });
    assert.equal(r2.state.atk, 0, 'sonraki oyuncunun turunda hak yenilendi');
    assert.equal(R.current(r2.state), 'p1');
});

test('menzilde hedef yoksa saldırı seçeneği yok (arayüz silah satırını göstermez): yalnızca zar', () => {
    const s = duelSetup('bow', 6);                       // menzil 5, hedef 6 adım uzakta
    assert.deepEqual(R.attackOptions(s, ctx()), []);
    assert.equal(R.botAction(s, ctx({ rand: () => 0.0 })).type, 'roll');
});

test('yürüyüşte/olay kutucuğunda bulunan silah sonraki tur başında kullanılabilir', () => {
    const zone = pirate.nodes.find((n) => n.type === 'weapon');
    const pre = pirate.nodes.find((n) => n.next.length === 1 && n.next[0] === zone.id);
    const s = game(2);
    s.chests = {};
    s.P.p0.pos = pre.id;
    const r = apply(s, { type: 'roll', by: 'p0' }, { dice: () => 1, rand: () => 2 / 11 });       // pompalı
    assert.equal(r.state.P.p0.w.shotgun, 1);
    assert.equal(R.current(r.state), 'p1', 'tur bitti: hemen kullanılamaz');
    // p1 de oynar (autoAction ile), tur sonu, minioyun; p0'ın sırası gelince silah kullanılabilir
    let st = r.state;
    for (let i = 0; i < 8 && st.stage !== 'mini'; i++) st = apply(st, R.autoAction(st, ctx()), { dice: () => 1 }).state;
    assert.equal(st.stage, 'mini');
    st = R.applyMinigame(st, { ranking: [['p1'], ['p0']] }, ctx()).state;
    for (let i = 0; i < 8 && !(R.current(st) === 'p0' && st.stage === 'roll'); i++) st = apply(st, R.autoAction(st, ctx()), { dice: () => 1 }).state;
    assert.equal(R.current(st), 'p0');
    st.P.p0.pos = loopNode.id; st.P.p1.pos = nodeAt(loopNode.id, 2);
    assert.ok(R.attackOptions(st, ctx()).some((o) => o.w === 'shotgun' && o.target === 'p1'), 'silah sonraki turda kullanılabilir');
});

test('öldürme turu bitirmez: öldüren hâlâ zar atabilir; ölünce tur başlangıçta devam eder', () => {
    const s = duelSetup('fist', 1);
    s.P.p1.hp = 10; s.P.p1.s = 4;
    const r = apply(s, { type: 'use', by: 'p0', w: 'fist', target: 'p1' });
    assert.equal(R.current(r.state), 'p0');
    const r2 = apply(r.state, { type: 'roll', by: 'p0' }, { dice: () => 1 });
    assert.equal(R.current(r2.state), 'p1');
});

// ---- kalkan: süre ve bekleme ----
// id'nin n. sonraki kendi turunun BAŞINA kadar (diğerleri otomatik oynar) ilerletir; geçen olayları toplar.
function toOwnTurnStart(st, id, n, evtsOut) {
    let seen = 0;
    let last = null;
    for (let i = 0; i < 400; i++) {
        if (st.stage === 'mini') {
            const mr = R.applyMinigame(st, { ranking: [st.order.slice()] }, ctx());
            if (evtsOut) mr.events.forEach((e) => evtsOut.push(e));
            st = mr.state; st.chests = {};
            continue;
        }
        const key = st.rd + ':' + st.turn;
        if (R.current(st) === id && st.stage === 'roll' && key !== last && (i > 0)) {
            last = key;
            seen++;
            if (seen === n) return st;
        }
        const r = apply(st, R.autoAction(st, ctx()), { dice: () => 1 });
        if (evtsOut) r.events.forEach((e) => evtsOut.push(e));
        st = r.state;
    }
    throw new Error('tur başına ulaşılamadı');
}

function shieldGame() {
    const s = game(2);
    s.chests = {};
    s.P.p0.pos = loopNode.id; s.P.p1.pos = nodeAt(loopNode.id, 40) || loopNode.id;
    s.P.p0.w = inv('shield', 'shield');
    return s;
}

test('kalkan: kurulu kalkan 3 kendi tur sonra düşer (süre bitince bekleme yok)', () => {
    let s = shieldGame();
    s.turn = 0; s.stage = 'roll'; s.atk = 0;
    let r = apply(s, { type: 'use', by: 'p0', w: 'shield' });
    assert.equal(r.state.P.p0.shield, true);
    assert.equal(r.state.P.p0.shl, 3);
    assert.equal(r.state.atk, 1, 'saldırı hakkı harcandı');
    let st = apply(r.state, { type: 'roll', by: 'p0' }, { dice: () => 1 }).state;
    const ev = [];
    st = toOwnTurnStart(st, 'p0', 1, ev);       // T+1 başı: 2 kaldı
    assert.equal(st.P.p0.shield, true); assert.equal(st.P.p0.shl, 2);
    st = toOwnTurnStart(st, 'p0', 1, ev);       // T+2 başı: 1 kaldı
    assert.equal(st.P.p0.shield, true); assert.equal(st.P.p0.shl, 1);
    st = toOwnTurnStart(st, 'p0', 1, ev);       // T+3 başı: düştü
    assert.equal(st.P.p0.shield, false, '3. kendi turun başında kalkan düştü');
    assert.ok(ev.some((e) => e.t === 'shieldend' && e.id === 'p0'));
    assert.equal(st.P.p0.scd, 0, 'süre dolması bekleme getirmez');
    // hemen yeniden kurulabilir
    st.P.p0.w = inv('shield');
    assert.ok(reduceT(st, { type: 'use', by: 'p0', w: 'shield' }, ctx()).ok);
});

test('kalkan: kırılınca 2 kendi tur yeniden kurulamaz, 3. turda kurulabilir', () => {
    let s = shieldGame();
    s.P.p0.shield = true; s.P.p0.shl = 3;
    s.P.p1.pos = s.P.p0.pos;
    s.P.p1.w = inv('bow');
    s.turn = 1; s.stage = 'roll'; s.atk = 0;
    const r = apply(s, { type: 'use', by: 'p1', w: 'bow', target: 'p0' });
    assert.ok(r.events.some((e) => e.t === 'block'));
    assert.equal(r.state.P.p0.shield, false);
    assert.ok(r.state.P.p0.scd > 0, 'bekleme başladı');
    let st = r.state;
    st.P.p0.w = inv('shield', 'shield');
    // kırıldığı turun kalanı + sonraki iki kendi tur: kurulamaz
    st = toOwnTurnStart(st, 'p0', 1);
    assert.equal(reduceT(st, { type: 'use', by: 'p0', w: 'shield' }, ctx()).ok, false, '1. kendi tur: bekleme');
    assert.ok(!R.attackOptions(st, ctx()).some((o) => o.w === 'shield'));
    st = toOwnTurnStart(st, 'p0', 1);
    assert.equal(reduceT(st, { type: 'use', by: 'p0', w: 'shield' }, ctx()).ok, false, '2. kendi tur: bekleme');
    st = toOwnTurnStart(st, 'p0', 1);
    assert.equal(st.P.p0.scd, 0);
    const ok = apply(st, { type: 'use', by: 'p0', w: 'shield' });
    assert.equal(ok.state.P.p0.shield, true, '3. kendi tur: yeniden kurulabilir');
});

test('kalkan: bot bekleme sürerken kalkan kurmaz; kuruluyken de kurmaz', () => {
    const s = shieldGame();
    s.P.p0.pos = loopNode.id; s.P.p1.pos = nodeAt(loopNode.id, 2);
    s.turn = 0; s.stage = 'roll'; s.atk = 0;
    assert.equal(R.botAction(s, ctx()).w, 'shield');
    s.P.p0.scd = 2;
    assert.equal(R.botAction(s, ctx()).type, 'roll');
    s.P.p0.scd = 0; s.P.p0.shield = true; s.P.p0.shl = 2;
    assert.equal(R.botAction(s, ctx()).type, 'roll');
});

test('kalkan: kurmak saldırı hakkını harcar — aynı turda silah kullanılamaz; silahtan sonra kalkan da kurulamaz', () => {
    const s = shieldGame();
    s.turn = 0; s.stage = 'roll'; s.atk = 0;
    s.P.p0.w = inv('shield', 'bow');
    s.P.p1.pos = s.P.p0.pos;
    const r = apply(s, { type: 'use', by: 'p0', w: 'shield' });
    assert.equal(reduceT(r.state, { type: 'use', by: 'p0', w: 'bow', target: 'p1' }, ctx()).ok, false, 'kalkandan sonra silah yok');
    const r2 = apply(s, { type: 'use', by: 'p0', w: 'bow', target: 'p1' });
    assert.equal(reduceT(r2.state, { type: 'use', by: 'p0', w: 'shield' }, ctx()).ok, false, 'silahtan sonra kalkan yok');
});

test('kalkan: başlangıç güvenli bölgesinde duran kalkanı harcanmaz (bekleme de başlamaz)', () => {
    const s = game(2);
    s.P.p1.shield = true; s.P.p1.shl = 3;
    s.P.p1.pos = s.home;
    s.P.p0.pos = loopNode.id; s.P.p0.w = inv('bomb'); s.turn = 0; s.stage = 'roll';
    s.P.p1.pos = s.home;
    const ev = [];
    const bombed = apply(Object.assign(s, {}), { type: 'use', by: 'p0', w: 'bomb', node: nodeAt(loopNode.id, 1, [s.home]) });
    assert.equal(bombed.state.P.p1.shield, true);
    assert.equal(bombed.state.P.p1.scd, 0);
    assert.ok(ev.length === 0);
});

// ---- lejant (yardım): içerik tablolardan üretilir ----
test('lejant: kutucuk türleri, sandıklar, olay olasılıkları ve silahlar kod tablolarından üretilir', () => {
    const lg = C.legend();
    assert.deepEqual(lg.nodes.map((n) => n.id), Object.keys(C.NODE_TYPES));
    lg.nodes.filter((n) => n.id !== 'normal').forEach((n) => assert.equal(n.icon, C.NODE_TYPES[n.id].icon));
    assert.equal(lg.nodes.find((n) => n.id === 'event').icon, '❓');
    assert.deepEqual(lg.chests.map((c) => c.icon), [C.CHEST_ICONS.star, C.CHEST_ICONS.weapon]);
    assert.deepEqual(lg.events, C.eventOdds());
    assert.equal(lg.events.reduce((a, e) => a + e.pct, 0), 100);
    assert.deepEqual(lg.weapons.map((w) => w.id), C.WEAPON_IDS);
    lg.weapons.forEach((w) => { assert.equal(w.icon, C.WEAPONS[w.id].emoji); assert.ok(w.desc.length > 10); assert.equal(w.weight, C.WEAPON_WEIGHTS[w.id]); });
});

test('lejant: silah açıklamaları sayıları tablodan alır (tablo değişince metin değişir)', () => {
    const d = (id) => C.legend().weapons.find((w) => w.id === id).desc;
    assert.match(d('fist'), /0–1/);
    assert.match(d('fist'), /100/);
    assert.match(d('shotgun'), /45/);
    assert.match(d('shotgun'), /30/);
    assert.match(d('shotgun'), /15/);
    assert.match(d('shotgun'), /0–3/);
    assert.match(d('bow'), /0–5/);
    assert.match(d('bow'), /20/);
    assert.match(d('bomb'), /Menzil 4/);
    assert.match(d('bomb'), /30/);
    assert.match(d('shield'), /3 tur sürer/);
    assert.match(d('shield'), /2 tur/);
    const saved = C.WEAPONS.bomb.damage;
    C.WEAPONS.bomb.damage = 77;
    try { assert.match(d('bomb'), /77/); } finally { C.WEAPONS.bomb.damage = saved; }
    const savedRange = C.WEAPONS.bow.range;
    C.WEAPONS.bow.range = 7;
    try { assert.match(d('bow'), /0–7/); } finally { C.WEAPONS.bow.range = savedRange; }
});

// ---- "N sıra sonra sen" ----
test('turnsUntil: sıradaki 0; bu turun kalanı; sonraki turda sıra bir kaymış sayılır', () => {
    const s = game(3);
    s.order = ['p0', 'p1', 'p2'];
    s.turn = 0;
    assert.deepEqual(['p0', 'p1', 'p2'].map((id) => R.turnsUntil(s, id)), [0, 1, 2]);
    s.turn = 1;
    assert.deepEqual(['p0', 'p1', 'p2'].map((id) => R.turnsUntil(s, id)), [4, 0, 1], 'p0 bu tur oynadı; sonraki turda p1,p2,p0 → 4. sıra');
    s.turn = 2;
    assert.deepEqual(['p0', 'p1', 'p2'].map((id) => R.turnsUntil(s, id)), [3, 1, 0]);
    // gerçek akışla tutarlı: öngörülen sıra sayısı kadar yeni tur başladıktan sonra o oyuncunun turu gelir
    for (const players of [2, 3, 4]) {
        for (let t = 0; t < players; t++) {
            const base = game(players);
            base.order = base.order.slice(); base.turn = t;
            for (const id of base.order) {
                const predicted = R.turnsUntil(base, id);
                let x = JSON.parse(JSON.stringify(base));
                x.chests = {};
                let turns = 0;
                let key = x.rd + ':' + x.turn;
                let guard = 0;
                while (!(R.current(x) === id && x.stage === 'roll' && turns > 0) && !(predicted === 0)) {
                    if (guard++ > 300) throw new Error('bulunamadı');
                    if (x.stage === 'mini') { x = R.applyMinigame(x, { ranking: [x.order.slice()] }, ctx()).state; x.chests = {}; }
                    else x = apply(x, R.autoAction(x, ctx()), { dice: () => 1 }).state;
                    if (x.stage === 'roll' && x.rd + ':' + x.turn !== key) { key = x.rd + ':' + x.turn; turns++; }
                    if (R.current(x) === id && x.stage === 'roll' && turns > 0) break;
                }
                assert.equal(predicted === 0 ? 0 : turns, predicted, players + ' oyuncu, turn ' + t + ', ' + id);
            }
        }
    }
});

test('turnsUntil: atlanacak oyuncular sayılmaz; minioyun/oyun sonu/bilinmeyen oyuncu null', () => {
    const s = game(4);
    s.order = ['p0', 'p1', 'p2', 'p3']; s.turn = 0;
    s.P.p1.sk = 1;
    assert.equal(R.turnsUntil(s, 'p2'), 1, 'p1 atlanacak');
    assert.equal(R.turnsUntil(s, 'p3'), 2);
    s.stage = 'mini';
    assert.equal(R.turnsUntil(s, 'p0'), null);
    s.stage = 'over';
    assert.equal(R.turnsUntil(s, 'p0'), null);
    s.stage = 'roll';
    assert.equal(R.turnsUntil(s, 'yok'), null);
    assert.equal(R.turnsUntil(s, '__proto__'), null);
    assert.equal(R.turnsUntil(null, 'p0'), null);
});
