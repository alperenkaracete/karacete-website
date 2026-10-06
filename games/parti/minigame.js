// Parti: minioyun sözleşmesi ve yer tutucu "Şans Çarkı".
//
//   startMinigame({ type: 'ffa' | 'duel', players: [id], seed }) -> Promise<{ ranking: [[id, ...], [id, ...], ...] }>
//
// ranking: en iyiden en kötüye gruplar; aynı gruptaki kimlikler eşit derecededir. 'duel' için iki oyuncu gelir ve
// sonuç [[kazanan], [kaybeden]] olur. Gerçek minioyunlar bu fonksiyonun yerini alır; Parti geri kalanı değişmez.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartiMinigame = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    function seeded(seed) {
        var s = (seed >>> 0) || 1;
        return function () {
            s = (s + 0x6D2B79F5) >>> 0;
            var t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    // Tohumdan rastgele sıralama (herkes aynı sonucu hesaplayabilir; çark animasyonu bunu kullanır)
    function wheelRanking(spec) {
        var rand = seeded(spec.seed);
        var ids = spec.players.slice();
        for (var i = ids.length - 1; i > 0; i--) {
            var j = Math.floor(rand() * (i + 1));
            var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
        }
        return ids.map(function (id) { return [id]; });
    }

    function startMinigame(spec) {
        return Promise.resolve({ ranking: wheelRanking(spec) });
    }

    return { startMinigame: startMinigame, wheelRanking: wheelRanking, seeded: seeded };
});
