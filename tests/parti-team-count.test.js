// Takım sayısı seçimi: 2'şerli (otomatik) dışında 2/3/4 takım (8 kişi 4+4, 6 kişi 3+3 ...). Takımlar eşit olmalı; etkin hedef
// = kişi başı hedef × gerçek takım büyüklüğü (state.ts).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../games/parti/config.js');
const R = require('../games/parti/rules.js');
const G = require('../games/parti/graph.js');
const { room, IDS, NAMES } = require('./duel-room.js');

test('teamCount/teamCheck/teamSize: otomatik 2\'şerli, eşit bölünme, takım başına ≥2, ≥2 takım', () => {
    const row = (n, tc) => [C.teamCount(n, tc), C.teamCheck(n, tc), C.teamSize(n, tc)];
    assert.deepEqual(row(8, 0), [4, null, 2]);
    assert.deepEqual(row(6, 0), [3, null, 2]);
    assert.deepEqual(row(4, 0), [2, null, 2]);
    assert.deepEqual(row(8, 2), [2, null, 4], '8 kişi 4+4');
    assert.deepEqual(row(6, 2), [2, null, 3], '6 kişi 3+3');
    assert.deepEqual(row(6, 3), [3, null, 2]);
    assert.deepEqual(row(8, 4), [4, null, 2]);
    assert.equal(row(8, 3)[2], null);
    assert.match(C.teamCheck(8, 3), /eşit bölünmez/);
    assert.match(C.teamCheck(7, 0), /çift/);
    assert.match(C.teamCheck(5, 2), /eşit bölünmez/);
    assert.match(C.teamCheck(2, 0), /en az 2 takım/);
    assert.match(C.teamCheck(4, 4), /en az 2 oyuncu/);
    assert.match(C.teamCheck(2, 2), /en az 2 oyuncu/);
    assert.deepEqual(C.TEAM_COUNTS, [2, 3, 4]);
});

const g = G.index(require('../games/parti/maps/pirate.js'));
function teamGame(n, teams, goal) {
    const seats = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, av: C.AVATARS[i], t: i % teams }));
    return R.createGame({ seed: 3, cfg: { mode: 'team', goal, map: 'pirate' }, seats }, { g });
}

test('etkin hedef gerçek takım büyüklüğüyle çarpılır: 4+4 → ×4, 3+3 → ×3, 2+2+2+2 → ×2; solo etkilenmez', () => {
    [[8, 2, 4], [6, 2, 3], [6, 3, 2], [8, 4, 2], [4, 2, 2]].forEach(([n, teams, size]) => {
        const s = teamGame(n, teams, 10);
        assert.equal(s.ts, size, n + '/' + teams);
        assert.equal(R.effectiveGoal(s), 10 * size);
    });
    const solo = R.createGame({ seed: 3, cfg: { mode: 'solo', goal: 10, map: 'pirate' }, seats: [{ id: 'a', name: 'a', av: 'x', t: 0 }, { id: 'b', name: 'b', av: 'x', t: 0 }] }, { g });
    assert.equal(solo.ts, undefined);
    assert.equal(R.effectiveGoal(solo), 10);
    const legacy = teamGame(4, 2, 10);
    delete legacy.ts;                                  // eski durum (ts yok): 2'şerli varsayılır
    assert.equal(R.effectiveGoal(legacy), 20);
});

test('8 kişi 4+4: takım toplamı 39 ⭐\'ta kazanmaz, 40 ⭐\'ta kazanır; 6 kişi 3+3: 29/30', () => {
    const t = teamGame(8, 2, 10);
    t.P.p0.s = 10; t.P.p2.s = 10; t.P.p4.s = 10; t.P.p6.s = 9;      // takım 0: 39
    R.checkWin(t);
    assert.equal(t.winner, null);
    t.P.p6.s = 10;
    R.checkWin(t);
    assert.deepEqual(t.winner, { kind: 'team', id: 0 });
    const u = teamGame(6, 2, 10);
    u.P.p0.s = 10; u.P.p2.s = 10; u.P.p4.s = 9;
    R.checkWin(u);
    assert.equal(u.winner, null);
    u.P.p4.s = 10;
    R.checkWin(u);
    assert.deepEqual(u.winner, { kind: 'team', id: 0 });
});

test('Son Çılgınlık eşiği 4+4 takımda etkin hedefe göre', () => {
    const s = teamGame(8, 2, 10);                     // etkin 40
    s.stage = 'mini'; s.turn = s.order.length; s.chests = {};
    s.P.p0.s = 10; s.P.p2.s = 10; s.P.p4.s = 9; s.P.p6.s = 8;     // 37: 3 kala
    assert.equal(R.applyMinigame(s, { ranking: [['p1'], ['p3']] }, { g }).state.fr, 1);
    const t = teamGame(8, 2, 10);
    t.stage = 'mini'; t.turn = t.order.length; t.chests = {};
    t.P.p0.s = 10; t.P.p2.s = 10; t.P.p4.s = 9; t.P.p6.s = 7;     // 36: 4 kala
    assert.equal(R.applyMinigame(t, { ranking: [['p1'], ['p3']] }, { g }).state.fr, 0);
});

// ---- lobi / makine ----
function lobby(n, extra) {
    const r = room(7, extra);
    for (let i = 0; i < n; i++) r.join(IDS[i], NAMES[i]);
    r.m('A').dispatch({ type: 'cfg', mode: 'team' });
    r.flush();
    return r;
}
const teamsOf = (r) => r.view('A').seats.map((s) => s.t).sort();
const counts = (r) => r.view('A').seats.reduce((a, s) => { a[s.t] = (a[s.t] || 0) + 1; return a; }, {});

test('lobi: 8 kişi, 2 takım → 4+4 dağıtılır, başlar, hedef × 4', () => {
    const r = lobby(8);
    assert.deepEqual(teamsOf(r), [0, 0, 1, 1, 2, 2, 3, 3], 'varsayılan otomatik: 2\'şerli 4 takım');
    r.m('A').dispatch({ type: 'cfg', tc: 2 });
    r.flush();
    assert.deepEqual(counts(r), { 0: 4, 1: 4 });
    assert.equal(r.view('A').cfg.tc, 2);
    assert.equal(r.view('B').cfg.tc, 2, 'takipçiler ayarı görür');
    assert.equal(r.view('A').startBlock, null);
    r.m('A').dispatch({ type: 'cfg', goal: 10 });
    r.flush();
    assert.equal(r.m('A').dispatch({ type: 'start' }), true);
    r.flush();
    const gm = r.view('B').game;
    assert.equal(gm.ts, 4);
    assert.equal(R.effectiveGoal(gm), 40);
    assert.ok(r.view('A').log.some((l) => /Hedef: 40 ⭐ \(takım\)/.test(l)));
});

test('lobi: 6 kişi 3+3 (tc=2) ve 2+2+2 (tc=3 / otomatik); geçersiz kombinasyon başlatmaz', () => {
    const r = lobby(6);
    assert.equal(r.view('A').startBlock, null);
    assert.deepEqual(counts(r), { 0: 2, 1: 2, 2: 2 });
    r.m('A').dispatch({ type: 'cfg', tc: 2 });
    r.flush();
    assert.deepEqual(counts(r), { 0: 3, 1: 3 });
    assert.equal(r.view('A').startBlock, null);
    r.m('A').dispatch({ type: 'cfg', tc: 3 });
    r.flush();
    assert.deepEqual(counts(r), { 0: 2, 1: 2, 2: 2 });
    assert.equal(r.view('A').startBlock, null);
    r.m('A').dispatch({ type: 'cfg', tc: 4 });
    r.flush();
    assert.match(r.view('A').startBlock, /eşit bölünmez/, '6 kişi 4 takıma bölünmez');
    assert.equal(r.m('A').dispatch({ type: 'start' }), false);
    r.flush();
    assert.equal(r.view('A').phase, 'lobby');
    r.m('A').dispatch({ type: 'cfg', tc: 0 });
    r.flush();
    assert.equal(r.view('A').startBlock, null);
});

test('lobi: takım dolu ise (4+4 modunda 4 kişi) 5. kişi alınmaz; elle taşıma ve eşit olmayan dağılım başlatmaz', () => {
    const r = lobby(8);
    r.m('A').dispatch({ type: 'cfg', tc: 2 });
    r.flush();
    const full = r.view('A').seats.filter((s) => s.t === 1)[0];
    const other = r.view('A').seats.filter((s) => s.t === 0)[0];
    r.m('A').dispatch({ type: 'team', id: other.i, t: 1 });          // takım 1 dolu (4)
    r.flush();
    assert.deepEqual(counts(r), { 0: 4, 1: 4 }, 'dolu takıma taşınmadı');
    // boşalt-doldur: biri 0'dan 2'ye (olmayan takım) giderse eşitlik bozulur, başlamaz
    r.m('A').dispatch({ type: 'team', id: other.i, t: 2 });
    r.flush();
    assert.match(r.view('A').startBlock, /tam 4/);
    assert.ok(full);
});

test('lobi: takım modunda sonradan giren/bot en az dolu takıma yerleşir', () => {
    const r = lobby(4);
    r.m('A').dispatch({ type: 'cfg', tc: 2 });
    r.flush();
    r.m('A').dispatch({ type: 'bot_add' });
    r.flush();
    const c = counts(r);
    assert.equal(c[0] + c[1], 5);
    assert.ok(Math.abs(c[0] - c[1]) <= 1, 'dengeli: ' + JSON.stringify(c));
});

test('takım ayarı ağda: eski yayında tc yok = otomatik; geçersiz tc reddedilir', () => {
    const r = lobby(4);
    r.m('A').dispatch({ type: 'cfg', tc: 2 });
    r.flush();
    const last = r.sent.filter((s) => s.from === 'A' && s.msg.type === 'pt_state').pop().msg;
    const bump = (m) => { m.rv = r.state('B').rv + 5; return m; };
    const old = bump(JSON.parse(JSON.stringify(last)));
    delete old.cf.tc;
    r.inject('B', old);
    assert.equal(r.view('B').cfg.tc, 0, 'tc yoksa otomatik');
    const bad = bump(JSON.parse(JSON.stringify(last)));
    bad.rv = r.state('B').rv + 9;
    bad.cf.tc = 7;
    const rv = r.state('B').rv;
    r.inject('B', bad);
    assert.equal(r.state('B').rv, rv, 'geçersiz tc reddedildi');
});

test('ui: takım sayısı satırı (eşit bölünmeyenler pasif), takım hedefi ipucu ve seçici takım sayısıyla sınırlı', () => {
    const ui = fs.readFileSync(path.join(__dirname, '..', 'games', 'parti', 'ui.js'), 'utf8');
    assert.ok(/'Takım sayısı'/.test(ui));
    assert.ok(/C\.teamCheck\(nSeats, k\) !== null/.test(ui), 'bölünemeyen seçenekler pasif');
    assert.ok(/act\(\{ type: 'cfg', tc: k \}\)/.test(ui));
    assert.ok(/'Takım hedefi: ' \+ per \* tsz/.test(ui));
    assert.ok(/C\.TEAMS\.slice\(0, /.test(ui));
});

// ---- Denge: büyük takımlarda tur uzunluğu (bot simülasyonu, kişi başı hedef 10) ----
const { simulate } = require('./parti-sim.js');
test('tur uzunluğu: 8 kişi 4+4 / 2+2+2+2 ve 6 kişi 3+3 / 2+2+2 ortalama turu solo\'nun 0,9-1,7 katı, oyunlar biter', () => {
    const cases = [[8, 'space', [4, 2]], [6, 'pirate', [3, 2]]];
    cases.forEach(([n, map, teamCounts]) => {
        const solo = simulate({ players: n, games: 40, seed: 900, mode: 'solo', goal: 10, map });
        assert.equal(solo.unfinished, 0);
        teamCounts.forEach((teams) => {
            const team = simulate({ players: n, games: 40, seed: 900, mode: 'team', teams, goal: 10, map });
            assert.equal(team.unfinished, 0, n + ' kişi ' + teams + ' takım biter');
            const ratio = team.avgRounds / solo.avgRounds;
            assert.ok(ratio > 0.9 && ratio < 1.7, n + ' kişi ' + teams + ' takım: takım/solo tur oranı ' + ratio.toFixed(2) + ' (solo ' + solo.avgRounds.toFixed(1) + ', takım ' + team.avgRounds.toFixed(1) + ')');
        });
    });
});
