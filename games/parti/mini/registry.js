// Parti: minioyun kaydı. Her oyun bir kez burada tanımlanır; seçim (rules.minigameSpec), config.DUEL_GAMES ve arayüz buradan okur.
//   { id, name, icon, kind: 'ffa' | 'duel' | 'grup', min, max, weight }
//   kind 'duel': iki kişilik, en az 2 İNSAN gerekir (botlar düelloya girmez); 'ffa': herkes aynı anda oynar, botlarla da oynanır
//   (en az 1 insan); 'grup': yalnız şemada tanımlı, henüz uygulaması yok -> hiçbir zaman seçilmez.
//   min/max: oyunun kabul ettiği İNSAN sayısı (ffa'da toplam oyuncu en çok max).
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartiMiniRegistry = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var GAMES = [
        { id: 'xox',      name: 'XOX',          icon: '❌', kind: 'duel', min: 2, max: 2, weight: 1 },
        { id: 'connect4', name: 'Dörtlü Bağla', icon: '🔴', kind: 'duel', min: 2, max: 2, weight: 1 },
        { id: 'catdog',   name: 'Kedi - Köpek', icon: '🐱', kind: 'duel', min: 2, max: 2, weight: 1 },
        { id: 'kurbaga',  name: 'Kurbağa',      icon: '🐸', kind: 'ffa',  min: 1, max: 8, weight: 1 },
        { id: 'dusenzemin', name: 'Düşen Zemin', icon: '🕳️', kind: 'ffa',  min: 1, max: 8, weight: 1 }
    ];
    var KINDS = ['ffa', 'duel', 'grup'];

    function get(id) {
        for (var i = 0; i < GAMES.length; i++) if (GAMES[i].id === id) return GAMES[i];
        return null;
    }

    function ids(kind) {
        return GAMES.filter(function (g) { return !kind || g.kind === kind; }).map(function (g) { return g.id; });
    }

    // Bu insan sayısıyla seçilebilen oyunlar ('grup' uygulanana kadar hiç seçilmez)
    function eligible(humans) {
        return GAMES.filter(function (g) {
            if (g.kind === 'grup' || !(g.weight > 0)) return false;
            return humans >= g.min;
        });
    }

    return { GAMES: GAMES, KINDS: KINDS, get: get, ids: ids, eligible: eligible };
});
