const test = require('node:test');
const assert = require('node:assert/strict');
const { simulate } = require('./parti-sim.js');

// Hızlı denge duman testi (<2 sn): tohum sabit olduğundan deterministik. Asıl denge sayıları PR tablosunda
// (node tests/parti-sim.js 240) raporlanır; buradaki eşikler yalnızca bariz bozulmayı yakalayacak kadar gevşektir.
const GAMES = 30;

for (const [players, maxFirstShare] of [[2, 0.7], [4, 0.55], [8, 0.4]]) {
    test(players + ' oyunculu bot simülasyonu: oyunlar biter, tur sayısı makul, bot kendini bombalamaz, ilk sıra aşırı avantajlı değil', () => {
        const t0 = Date.now();
        const res = simulate({ players, games: GAMES, seed: 4242, map: players === 8 ? 'space' : 'pirate' });
        assert.equal(res.unfinished, 0, 'bitmeyen oyun');
        assert.ok(res.avgRounds >= 3 && res.avgRounds <= 40, 'ort. tur ' + res.avgRounds);
        assert.equal(res.selfBombs, 0, 'bot kendi kutucuğuna bomba atmadı');
        assert.ok(Math.max.apply(null, res.winShare) < 0.8, 'tek koltuk baskın değil: ' + res.winShare);
        assert.ok(res.winShare[0] <= maxFirstShare, 'ilk sıra payı ' + res.winShare[0]);
        assert.equal(res.winShare.length, players);
        assert.ok(Math.abs(res.winShare.reduce((a, b) => a + b, 0) - 1) < 1e-9);
        assert.ok(Date.now() - t0 < 2000, 'simülasyon <2 sn');
    });
}

test('simülasyon deterministik: aynı tohum aynı sonuç', () => {
    const a = simulate({ players: 4, games: 10, seed: 77 });
    const b = simulate({ players: 4, games: 10, seed: 77 });
    assert.deepEqual(a, b);
    const c = simulate({ players: 4, games: 10, seed: 78 });
    assert.notDeepEqual(a.winShare.concat(a.avgRounds), c.winShare.concat(c.avgRounds));
});

test('otomatik hedef simülasyonda uygulanır: 2 oyuncu daha uzun (hedef 15), 4+ oyuncu kısa (hedef 10)', () => {
    const two = simulate({ players: 2, games: 20, seed: 5 });
    const four = simulate({ players: 4, games: 20, seed: 5 });
    assert.ok(two.avgRounds > four.avgRounds - 1, 'hedef 15 → daha çok tur: ' + two.avgRounds + ' vs ' + four.avgRounds);
});
