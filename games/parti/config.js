// Parti: ayarlar (silahlar, olaylar, ödüller, süreler). Oyun mantığı bu tabloları okur; değerleri değiştirmek yeterlidir.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./mini/registry.js'));
    else root.PartiConfig = factory(root.PartiMiniRegistry);
})(typeof self !== 'undefined' ? self : this, function (Registry) {
    'use strict';

    var WEAPONS = {
        fist:    { id: 'fist',    name: 'Yumruk',  emoji: '👊', kind: 'target', range: 1, dmg: { 0: 100, 1: 100 } },      // menzil 0-1 (aynı ya da komşu kutucuk), tek vuruş
        shotgun: { id: 'shotgun', name: 'Pompalı', emoji: '🔫', kind: 'target', range: 3, dmg: { 0: 45, 1: 45, 2: 30, 3: 15 } },
        bow:     { id: 'bow',     name: 'Yay',     emoji: '🏹', kind: 'target', range: 5, dmg: { 0: 20, 1: 20, 2: 20, 3: 20, 4: 20, 5: 20 } },
        bomb:    { id: 'bomb',    name: 'Bomba',   emoji: '💣', kind: 'area',   range: 4, damage: 30 },
        shield:  { id: 'shield',  name: 'Kalkan',  emoji: '🛡️', kind: 'shield' }
    };
    var SHIELD_TURNS_VALUE = 3;
    var SHIELD_CD_VALUE = 2;
    var WEAPON_IDS = ['fist', 'shotgun', 'bow', 'bomb', 'shield'];

    // Olay kutucuğu: ağırlıklı rastgele küçük olay
    // text: günlük cümlesi; announce: ekrandaki spiker yazısı ({name} = oyuncu adı); label: lejanttaki kısa ad
    var EVENTS = [
        { id: 'star',     weight: 3, icon: '⭐', label: '+1 yıldız',        text: 'bir yıldız buldu',              announce: '⭐ {name} bir yıldız buldu (+1⭐)' },
        { id: 'damage',   weight: 3, icon: '💥', label: 'tuzak −15 can',    text: 'tuzağa düştü',                  announce: '💥 {name} tuzağa düştü (−15❤️)', damage: 15 },
        { id: 'teleport', weight: 2, icon: '🌀', label: 'başlangıca ışınlan', text: 'başlangıca ışınlandı',        announce: '🌀 {name} başlangıca ışınlandı' },
        { id: 'weapon',   weight: 3, icon: '🎁', label: 'hediye silah',     text: 'hediye silah buldu',            announce: '🎁 {name} hediye silah buldu' },
        { id: 'rest',     weight: 2, icon: '💤', label: 'bir tur dinlen',   text: 'dinleniyor (bir tur atlar)',    announce: '💤 {name} dinleniyor (bir tur atlar)' }
    ];

    // Olay olasılıkları yüzde (ağırlıklardan; toplam tam 100, en büyük kalan yöntemi)
    function eventOdds() {
        var total = 0;
        EVENTS.forEach(function (e) { total += e.weight; });
        var rows = EVENTS.map(function (e) {
            var exact = 100 * e.weight / total;
            return { id: e.id, icon: e.icon, label: e.label, pct: Math.floor(exact), rem: exact - Math.floor(exact) };
        });
        var left = 100 - rows.reduce(function (a, r) { return a + r.pct; }, 0);
        rows.slice().sort(function (a, b) { return b.rem - a.rem; }).slice(0, left).forEach(function (r) { r.pct++; });
        return rows.map(function (r) { return { id: r.id, icon: r.icon, label: r.label, pct: r.pct }; });
    }

    function eventAnnounce(id, name) {
        for (var i = 0; i < EVENTS.length; i++) if (EVENTS[i].id === id) return EVENTS[i].announce.replace('{name}', name);
        return null;
    }

    // Kutucuk türleri (tahta + lejant): 🎁 yalnızca silah sandığı/ödül için kullanılır, olay kutucuğu ❓'dür.
    var NODE_TYPES = {
        normal:   { icon: '',   fill: null,      name: 'Yol' },
        start:    { icon: '🏁', fill: '#c9ced6', name: 'Başlangıç (güvenli bölge)' },
        treasure: { icon: '✨', fill: '#ffd24a', name: 'Hazine noktası (sandık çıkar)' },
        weapon:   { icon: '⚔️', fill: '#ff7a6b', name: 'Silah bölgesi (rastgele silah)' },
        event:    { icon: '❓', fill: '#b78cff', name: 'Olay kutucuğu' }
    };

    var DUEL_HOLD_BY_GAME = { xox: 2500, connect4: 3000, catdog: 4000 };
    var DUEL_LIMIT_STRIP_MS = 2500;

    // Minioyun ödülü: derece -> { stars, weapon (rastgele silah), shield }
    var REWARDS = {
        1: { stars: 1, weapon: true },
        2: { weapon: true },
        3: { heal: 25 }
    };

    // Rastgele silah ağırlıkları (kalkan ve bomba nadir, pompalı/yay sık)
    var WEAPON_WEIGHTS = { fist: 1, shotgun: 3, bow: 3, bomb: 2, shield: 2 };

    // Sandık simgeleri (tahta + lejant ortak)
    var CHEST_ICONS = { star: '🧰', weapon: '🎁' };

    // Silah açıklaması: tablolardan üretilir (ayrı metin kopyası yok)
    function weaponDesc(def) {
        if (def.kind === 'shield') {
            return 'Bir saldırıyı engeller; zardan önce kurulur ve o turun saldırı hakkını harcar. ' + SHIELD_TURNS_VALUE + ' tur sürer, kırılınca ' + SHIELD_CD_VALUE + ' tur yeniden kurulamaz.';
        }
        if (def.kind === 'area') {
            return 'Menzil ' + def.range + ': seçilen kutucuktaki herkese (kendine de) ' + def.damage + ' hasar. Başlangıçtakilere işlemez.';
        }
        var dists = Object.keys(def.dmg).map(Number).filter(function (d) { return d >= 1; }).sort(function (a, b) { return a - b; });
        var vals = dists.map(function (d) { return def.dmg[d]; });
        var same = vals.every(function (v) { return v === vals[0]; });
        var dmgText = same ? 'hasar ' + vals[0] : dists.map(function (d) { return d + ' adım: ' + def.dmg[d]; }).join(' · ');
        var minR = def.dmg[0] !== undefined ? 0 : 1;
        return 'Menzil ' + minR + '–' + def.range + ' adım, ' + dmgText + (minR === 0 ? ' (aynı kutucuktakine de vurur)' : '') + '. Başlangıçtakilere işlemez.';
    }

    // Lejant verisi (arayüz yalnızca bunu çizer): kutucuk türleri, sandıklar, olay olasılıkları, silahlar
    function legend() {
        return {
            nodes: Object.keys(NODE_TYPES).map(function (k) { return { id: k, icon: NODE_TYPES[k].icon || '⚪', name: NODE_TYPES[k].name }; }),
            chests: [
                { id: 'star', icon: CHEST_ICONS.star, name: 'Yıldız sandığı (1 ya da 2 ⭐; üzerinden geçen alır)' },
                { id: 'weapon', icon: CHEST_ICONS.weapon, name: 'Silah sandığı (rastgele silah)' }
            ],
            events: eventOdds(),
            weapons: WEAPON_IDS.map(function (w) {
                var def = WEAPONS[w];
                return { id: w, icon: def.emoji, name: def.name, weight: WEAPON_WEIGHTS[w], desc: weaponDesc(def) };
            })
        };
    }

    return {
        MAX_HP: 100,
        INVENTORY_PER_TYPE: 3,       // sınırsız envanter: tür başına en çok 3
        INVENTORY_TOTAL: 6,          // toplam en çok 6 (fazlası 'kaçtı')
        SHIELD_MAX: 1,               // envanterde en çok 1 kalkan
        SHIELD_TURNS: SHIELD_TURNS_VALUE,             // kurulu kalkan 3 kendi tur sonra düşer
        SHIELD_COOLDOWN_TURNS: SHIELD_CD_VALUE,       // kalkan kırılınca 2 kendi tur yeniden kurulamaz
        MIN_PLAYERS: 2,
        MAX_PLAYERS: 8,
        STAGE_MS: { roll: 20000, choose: 8000 },   // aşama başına süre (roll: silah seç + zar at)
        DISCONNECT_BOT_MS: 30000,    // sırası gelen kopmuş oyuncu için bot devralmadan önce bekleme
        AFK_BOT_DELAY_MS: 3000,      // AFK oyuncunun turunda bot oynamadan önce bekleme (insan "Ben buradayım" diyebilsin)
        AFK_TURNS: 2,                // üst üste bu kadar AFK turdan sonra bot devralır
        DISCONNECT_MS: 180000,       // kopan oyuncuyu bekleme
        BOT_DELAY_MS: 900,           // bot eylemleri arası (görünürlük)
        MINI_HOLD_MS: 5000,          // minioyun sonucu ekranda kalma
        // Düelloda TOPLAM süre sınırı yoktur (oyunlar yarıda kesilmez). Yalnız kopma (DUEL_RECONNECT_MS) ve hamle başına boşta sınırı:
        // sırası gelen oyuncu bu kadar hiç hamle yapmazsa o maçı kaybeder.
        DUEL_IDLE_MS: 180000,
        DUEL_CATDOG_SHOTS: 5,        // Kedi - Köpek: oyuncu başına atış sınırı
        DUEL_LIMIT_STRIP_MS: DUEL_LIMIT_STRIP_MS, // atış sınırı şeridi gecikmesi: yalnız son atışın süresi bilinmiyorsa yedek
        ANIM_NET_PAD_MS: 500,        // banner gecikmesine (son atış animasyonu) eklenen ağ payı; animasyonsuz oyunda eklenmez
        DUEL_RESULT_HOLD_MS: DUEL_HOLD_BY_GAME,   // banner göründükten sonra oyun ekranda kalma (hAt = bAt + bu)
        duelHold: function (game, reason) {
            if (reason === 'forfeit' || reason === 'fuse' || reason === 'idle') return 0;
            return DUEL_HOLD_BY_GAME[game] || 0;
        },
        DUEL_RECONNECT_MS: 25000,    // düello oyuncusu koparsa dönmesi için bekleme; dönmezse kopan kaybeder
        MINI: Registry,             // minioyun kaydı: oyun listesi, tür, uygunluk (mini/registry.js)
        // Kurbağa (ffa): toplam süre, ilk varıştan sonra kalan süre, geri sayım payı, ağ raporu aralıkları, lider yayını sınırı
        KURBAGA_MS: 120000,
        KURBAGA_LAST_CALL_MS: 20000,
        KURBAGA_COUNTDOWN_MS: 4000,       // 3-2-1 + ağ payı: oyun t=0 bu kadar sonra (herkes aynı yayından hizalanır)
        KURBAGA_SEND_MS: 250,             // sıçrama raporlarını birleştirme aralığı (ölüm/varış anında hemen)
        KURBAGA_HEARTBEAT_MS: 2000,       // değişiklik olmasa da son durumu yeniden gönderme (lider devri / kayıp mesaj)
        KURBAGA_PUBLISH_MS: 500,          // lider ilerleme çubuğu yayınlarının alt aralığı (varış/ilk rapor hemen)
        DUEL_GAMES: Registry.ids('duel'),   // geriye uyum: düello oyunları registry'den türer (mini/registry.js)
        GOALS: [5, 10, 15, 20, 25],
        GOAL_AUTO: 0,                // 0 = otomatik: 2-3 kişide 15, 4-8 kişide 10
        autoGoal: function (players) { return players <= 3 ? 15 : 10; },
        DEFAULT_GOAL: 0,
        // yıldız sandığı sayısı = ceil(oyuncu/2)+1; silah sandığı sabit 1
        starChests: function (players) { return Math.ceil(players / 2) + 1; },
        FRENZY_STARS_LEFT: 3,        // biri hedefe bu kadar yıldız kala 'Son Çılgınlık': sandıklar ×2
        EMOTES: ['😂', '😱', '👏', '🤡'],
        EMOTE_GAP_MS: 1000,          // oyuncu başına en az bu kadar aralık
        DEATH_LOSS_MAX: 3,           // ölümde en çok bu kadar yıldız kaybedilir (min(3, floor(yıldız/2)))
        CHESTS: { weapon: 1, bigStarChance: 0.3 },
        DICE: 6,
        LOG_MAX: 30,
        WEAPONS: WEAPONS,
        WEAPON_IDS: WEAPON_IDS,
        EVENTS: EVENTS,
        eventOdds: eventOdds,
        legend: legend,
        weaponDesc: weaponDesc,
        CHEST_ICONS: CHEST_ICONS,
        eventAnnounce: eventAnnounce,
        NODE_TYPES: NODE_TYPES,
        REWARDS: REWARDS,
        // Düelloda olmayanlar (sıralamada yer almayanlar) için küçük teselli: iyileşme (üst sınır MAX_HP).
        // REWARDS[3] ile çakışmaz: o derece yalnızca sıralamadakilere verilir; sıralamadakiler teselli almaz.
        MINI_CONSOLATION: { heal: 25 },
        WEAPON_WEIGHTS: WEAPON_WEIGHTS,
        TEAMS: [
            { id: 0, name: 'Kırmızı', color: '#e5484d' },
            { id: 1, name: 'Mavi', color: '#2f80ed' },
            { id: 2, name: 'Yeşil', color: '#2fb457' },
            { id: 3, name: 'Sarı', color: '#e8b400' }
        ],
        AVATARS: ['🦊', '🐼', '🐸', '🦁', '🐙', '🦄', '🐵', '🐯', '🐧', '🦉', '🐲', '🤖']
    };
});
