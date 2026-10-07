// Parti: ayarlar (silahlar, olaylar, ödüller, süreler). Oyun mantığı bu tabloları okur; değerleri değiştirmek yeterlidir.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartiConfig = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var WEAPONS = {
        fist:    { id: 'fist',    name: 'Yumruk',  emoji: '👊', kind: 'target', range: 1, dmg: { 1: 30 } },
        shotgun: { id: 'shotgun', name: 'Pompalı', emoji: '🔫', kind: 'target', range: 3, dmg: { 1: 45, 2: 30, 3: 15 } },
        bow:     { id: 'bow',     name: 'Yay',     emoji: '🏹', kind: 'target', range: 5, dmg: { 1: 20, 2: 20, 3: 20, 4: 20, 5: 20 } },
        bomb:    { id: 'bomb',    name: 'Bomba',   emoji: '💣', kind: 'area',   range: 4, damage: 30 },
        shield:  { id: 'shield',  name: 'Kalkan',  emoji: '🛡️', kind: 'shield' }
    };
    var WEAPON_IDS = ['fist', 'shotgun', 'bow', 'bomb', 'shield'];

    // Olay kutucuğu: ağırlıklı rastgele küçük olay
    var EVENTS = [
        { id: 'star',     weight: 3, text: 'bir yıldız buldu' },
        { id: 'damage',   weight: 3, text: 'tuzağa düştü', damage: 15 },
        { id: 'teleport', weight: 2, text: 'başlangıca ışınlandı' },
        { id: 'weapon',   weight: 3, text: 'hediye silah buldu' },
        { id: 'rest',     weight: 2, text: 'dinleniyor (bir tur atlar)' }
    ];

    // Minioyun ödülü: derece -> { stars, weapon (rastgele silah), shield }
    var REWARDS = {
        1: { stars: 1, weapon: true },
        2: { weapon: true },
        3: { heal: 25 }
    };

    // Rastgele silah ağırlıkları (kalkan ve bomba nadir, pompalı/yay sık)
    var WEAPON_WEIGHTS = { fist: 1, shotgun: 3, bow: 3, bomb: 2, shield: 2 };

    return {
        MAX_HP: 100,
        INVENTORY: 3,
        MIN_PLAYERS: 2,
        MAX_PLAYERS: 8,
        STAGE_MS: { roll: 15000, choose: 8000, act: 15000, swap: 15000 },   // aşama başına süre
        DISCONNECT_BOT_MS: 30000,    // sırası gelen kopmuş oyuncu için bot devralmadan önce bekleme
        AFK_BOT_DELAY_MS: 3000,      // AFK oyuncunun turunda bot oynamadan önce bekleme (insan "Ben buradayım" diyebilsin)
        AFK_TURNS: 2,                // üst üste bu kadar AFK turdan sonra bot devralır
        DISCONNECT_MS: 180000,       // kopan oyuncuyu bekleme
        BOT_DELAY_MS: 900,           // bot eylemleri arası (görünürlük)
        MINI_HOLD_MS: 5000,          // minioyun sonucu ekranda kalma
        GOALS: [5, 10, 15, 20, 25],
        GOAL_AUTO: 0,                // 0 = otomatik: 2-3 kişide 15, 4-8 kişide 10
        autoGoal: function (players) { return players <= 3 ? 15 : 10; },
        DEFAULT_GOAL: 0,
        // yıldız sandığı sayısı = ceil(oyuncu/2)+1; silah sandığı sabit 1
        starChests: function (players) { return Math.ceil(players / 2) + 1; },
        DEATH_LOSS_MAX: 3,           // ölümde en çok bu kadar yıldız kaybedilir (min(3, floor(yıldız/2)))
        CHESTS: { weapon: 1, bigStarChance: 0.3 },
        DICE: 6,
        LOG_MAX: 30,
        WEAPONS: WEAPONS,
        WEAPON_IDS: WEAPON_IDS,
        EVENTS: EVENTS,
        REWARDS: REWARDS,
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
