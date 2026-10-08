// Takım modunda etkin hedef = kişi başı hedef × TEAM_SIZE (rules.effectiveGoal). Solo mod birebir aynı.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../games/parti/config.js');
const R = require('../games/parti/rules.js');
const G = require('../games/parti/graph.js');
const { simulate } = require('./parti-sim.js');

const g = G.index(require('../games/parti/maps/pirate.js'));
const seats = (n, teams) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, av: C.AVATARS[i], t: teams ? Math.floor(i / 2) : 0 }));
const mk = (mode, goal, n) => R.createGame({ seed: 5, cfg: { mode, goal, map: 'pirate' }, seats: seats(n || 4, mode === 'team') }, { g });
const mini = (mode, goal) => { const s = mk(mode, goal); s.stage = 'mini'; s.turn = s.order.length; s.chests = {}; return s; };

test('TEAM_SIZE ve effectiveGoal: takımda kişi başı × 2; solo aynen; state.goal bireysel kalır', () => {
    assert.equal(C.TEAM_SIZE, 2);
    const t = mk('team', 10);
    assert.equal(t.goal, 10, 'state.goal kişi başı');
    assert.equal(R.effectiveGoal(t), 20);
    const s = mk('solo', 10);
    assert.equal(R.effectiveGoal(s), 10);
    assert.equal(R.effectiveGoal(mk('team', 0)), C.autoGoal(4) * 2, 'otomatik hedef de kişi başı: 4 oyuncuda 10 → takım 20');
    assert.equal(R.effectiveGoal(mk('solo', 25)), 25);
});

test('takımda 10 kişi başı hedef: takım 19 ⭐\'ta kazanmaz, 20 ⭐\'ta kazanır (toplam)', () => {
    const t = mk('team', 10);
    t.P.p0.s = 10; t.P.p1.s = 9;
    R.checkWin(t);
    assert.equal(t.winner, null, '19: kazanmadı (eskiden 10 yeterdi)');
    t.P.p1.s = 10;
    R.checkWin(t);
    assert.deepEqual(t.winner, { kind: 'team', id: 0 });
    // yalnız bir oyuncunun kişi başı hedefe ulaşması takımı kazandırmaz
    const u = mk('team', 10);
    u.P.p0.s = 12;
    R.checkWin(u);
    assert.equal(u.winner, null);
});

test('solo aynı: tek oyuncu hedef yıldıza ulaşınca kazanır, hedef altında kazanmaz', () => {
    const s = mk('solo', 10);
    s.P.p0.s = 9;
    R.checkWin(s);
    assert.equal(s.winner, null);
    s.P.p0.s = 10;
    R.checkWin(s);
    assert.deepEqual(s.winner, { kind: 'player', id: 'p0' });
});

test('Son Çılgınlık: takımda eşik etkin hedefe göre (hedefe 3 ⭐ kala), solo değişmedi', () => {
    const s = mini('team', 10);                       // etkin 20
    s.P.p0.s = 9; s.P.p1.s = 8;                       // 17: tam 3 kala
    assert.equal(R.applyMinigame(s, { ranking: [['p2'], ['p3']] }, { g }).state.fr, 1);
    const t = mini('team', 10);
    t.P.p0.s = 8; t.P.p1.s = 8;                       // 16: 4 kala (eski kuralda 10'u çoktan aşmış sayılırdı)
    assert.equal(R.applyMinigame(t, { ranking: [['p2'], ['p3']] }, { g }).state.fr, 0);
    const u = mini('solo', 10);
    u.P.p0.s = 7;
    assert.equal(R.applyMinigame(u, { ranking: [['p2'], ['p3']] }, { g }).state.fr, 1, 'solo: 3 kala');
    const v = mini('solo', 10);
    v.P.p0.s = 6;
    assert.equal(R.applyMinigame(v, { ranking: [['p2'], ['p3']] }, { g }).state.fr, 0);
});

test('standings (takım) toplam yıldıza göre sıralar; hedef değişkeninden bağımsız', () => {
    const t = mk('team', 10);
    t.P.p0.s = 4; t.P.p1.s = 3; t.P.p2.s = 9; t.P.p3.s = 0;
    const st = R.standings(t);
    assert.deepEqual(st.map((x) => [x.t, x.s]), [[1, 9], [0, 7]]);
});

test('tur uzunluğu: takım modu ortalama tur sayısı solo ile aynı mertebede (bot simülasyonu)', () => {
    const solo = simulate({ players: 4, games: 40, seed: 900, mode: 'solo', goal: 10 });
    const team = simulate({ players: 4, games: 40, seed: 900, mode: 'team', goal: 10 });
    assert.equal(solo.unfinished, 0);
    assert.equal(team.unfinished, 0);
    const ratio = team.avgRounds / solo.avgRounds;
    assert.ok(ratio > 0.7 && ratio < 1.6, 'takım/solo tur oranı ' + ratio.toFixed(2) + ' (solo ' + solo.avgRounds.toFixed(1) + ', takım ' + team.avgRounds.toFixed(1) + ')');
    // eski kuralda (hedef toplam 10) takım oyunu yaklaşık yarı sürerdi: şimdi solo'dan belirgin kısa değil
    assert.ok(team.avgRounds > solo.avgRounds * 0.7);
});

test('ui/makine: etkin hedef gösterimi (tur çubuğu, takım çipleri, lobide kişi başı etiketi + takım hedefi)', () => {
    const root = path.join(__dirname, '..');
    const ui = fs.readFileSync(path.join(root, 'games', 'parti', 'ui.js'), 'utf8');
    assert.ok(/'Tur ' \+ g\.rd \+ ' · Hedef ' \+ R\.effectiveGoal\(g\) \+ ' ⭐'/.test(ui));
    assert.ok(/R\.teamStars\(g, Number\(t\)\) \+ '\/' \+ R\.effectiveGoal\(g\) \+ ' ⭐'/.test(ui));
    assert.ok(/'Hedef ⭐ \(kişi başı\)'/.test(ui));
    assert.ok(/'Takım hedefi: ' \+ per \* C\.TEAM_SIZE/.test(ui));
    const machine = fs.readFileSync(path.join(root, 'games', 'parti', 'machine.js'), 'utf8');
    assert.ok(/R\.effectiveGoal\(M\.g\)/.test(machine));
    assert.ok(!/\.goal\b[^;]*\bteamStars|teamStars[^;]*state\.goal/.test(fs.readFileSync(path.join(root, 'games', 'parti', 'rules.js'), 'utf8')), 'rules.js takım karşılaştırmasında ham goal kullanmaz');
});
