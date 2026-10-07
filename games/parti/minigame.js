// Parti: minioyun sözleşmesi ve yedek "Şans Çarkı".
//
//   startMinigame({ type, players, seed, ... }) -> Promise<{ ranking: [[id, ...], [id, ...], ...] }>
//
// Zorunlu alanlar: type ('ffa' | 'duel'), players ([id]), seed (sayı). Geriye uyumlu isteğe bağlı alanlar (düello):
//   game        düello oyunu ('xox' | 'connect4' ...); PartiDuelAdapter.supports(game) olmalı
//   me          { id, name }  bu istemcideki oyuncu
//   isLeader    bu istemci lider mi (yalnız lider sonucu hakem ile hesaplar; diğerlerinin Promise'i yok sayılır)
//   leader      liderin kimliği (reset/catchup yalnız ondan kabul edilir)
//   root        minioyunun çizileceği DOM düğümü (oyuncuya oyun, izleyiciye kart çizilir)
//   net         { send(m), on(fn(from, m)) -> off }  pt_mg zarfı makinede: { type:'pt_mg', mg, from, m }
//   names       { id: ad }
//   deadlineMs  toplam süre (düello 90 sn); dolunca bitmemiş oyun için kısmi/beraberlik sonucu
//   signal      AbortSignal: iptalde oyun yıkılır, kök temizlenir, Promise { ranking:null, aborted:true } ile biter
// Alanlar eksikse ya da oyun bilinmiyorsa yedek olarak seed'den deterministik Şans Çarkı sonucu verilir; böylece
// minioyun asla takılı kalmaz.
//
// ranking: en iyiden en kötüye gruplar; aynı gruptaki kimlikler eşit derecededir. 'duel' için iki oyuncu gelir ve sonuç
// [[kazanan], [kaybeden]], beraberlikte [[a, b]] olur. Makine sonucu normalizeRanking ile temizler (machine.js):
//   - players dışı kimlikler ve tekrarlar atılır; sıralamada olmayan oyuncular SON gruba (eşit derece) eklenir;
//   - boş/geçersiz sonuç -> tüm oyuncular tek grup (hepsi eşit).
// Ödüller (config REWARDS) dereceye göredir: [[a,b]] -> ikisi de 1.; [[w],[l]] -> 1. ve 2. DÜELLODA OLMAYAN oyuncular ranking'de
// yer almaz; ödül yerine teselli (+25 can, config MINI_CONSOLATION) alır (ffa'da herkes sıralanır). Kopan insanlar finishMini'de sona yazılır.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./mini/duel-adapter.js'));
    else root.PartiMinigame = factory(root.PartiDuelAdapter);
})(typeof self !== 'undefined' ? self : this, function (Adapter) {
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

    function wheel(spec) {
        return { ranking: wheelRanking(spec) };
    }

    function startMinigame(spec) {
        var playable = spec.type === 'duel' && spec.game && Adapter && Adapter.supports(spec.game) &&
            spec.root && spec.net && spec.me && spec.players && spec.players.length === 2;
        if (!playable) return Promise.resolve(wheel(spec));
        // Oyun kurulamazsa (eksik betik vb.) çark: oyun takılı kalmaz
        return Adapter.run(spec).then(null, function () { return wheel(spec); });
    }

    return { startMinigame: startMinigame, wheelRanking: wheelRanking, seeded: seeded };
});
