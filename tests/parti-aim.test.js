// Beceri silahları nişan mantığı (aim.js): determinizm, gösterge, kademeler, kenetleme, bot dağılımı ve YAY KALİBRASYONU
// (referans oyuncu ortalaması 20 ± %10, tek vuruş ≤ 50, yakın uzaktan belirgin kolay).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../games/parti/config.js');
const A = require('../games/parti/aim.js');

const SK = C.WEAPONS.bow.skill;

test('config: yay bar becerisi, yumruk şov, diğerlerinin skill\'i yok; aşama süresi maxMs+1500; kenetleme sabitleri config\'te', () => {
    assert.equal(SK.kind, 'bar');
    assert.equal(SK.maxMs, 3000);
    assert.deepEqual(C.WEAPONS.fist.skill, { kind: 'show', ms: 900 });
    ['shotgun', 'bomb', 'shield'].forEach((w) => assert.equal(C.WEAPONS[w].skill, undefined, w));
    assert.equal(C.STAGE_MS.aim, SK.maxMs + 1500);
    assert.equal(C.AIM_SLACK_MS, 450);
    assert.equal(C.AIM_MIN_MS, 250);
    assert.equal(C.AIM_REF_SIGMA, 0.15);
    assert.equal(A.makeAim('shotgun', 1, 2), null, 'skill yok: aim yok');
    assert.equal(A.makeAim('fist', 1, 1), null, 'şov bar değil');
    assert.equal(A.makeAim('yok', 1, 1), null);
});

test('makeAim: tohumdan deterministik; bölge kenarlara taşmaz; genişlik uzaklığa göre %44 -> %13 doğrusal; periyot 1.2-1.6 sn', () => {
    assert.deepEqual(A.makeAim('bow', 77, 3), A.makeAim('bow', 77, 3));
    assert.notDeepEqual(A.makeAim('bow', 77, 3), A.makeAim('bow', 78, 3));
    const widths = [1, 2, 3, 4, 5].map((d) => A.makeAim('bow', 5, d).half * 2);
    assert.ok(Math.abs(widths[0] - 0.44) < 1e-9 && Math.abs(widths[4] - 0.13) < 1e-9, widths.join());
    for (let i = 1; i < 5; i++) assert.ok(widths[i] < widths[i - 1], 'uzaklaştıkça daralır');
    for (let i = 2; i < 5; i++) assert.ok(Math.abs((widths[i] - widths[i - 1]) - (widths[1] - widths[0])) < 1e-9, 'doğrusal');
    assert.equal(A.makeAim('bow', 5, 0).half, A.makeAim('bow', 5, 1).half, 'd=0 de d=1 genişliği');
    for (let seed = 1; seed <= 500; seed++) {
        for (let d = 0; d <= 5; d++) {
            const s = A.makeAim('bow', seed, d);
            assert.ok(s.c - s.half >= -1e-12 && s.c + s.half <= 1 + 1e-12, 'taşmaz');
            assert.ok(s.periodMs >= 1200 && s.periodMs <= 1600);
            assert.ok(s.phase >= 0 && s.phase < 1);
        }
    }
    const cs = new Set();
    for (let seed = 1; seed <= 50; seed++) cs.add(A.makeAim('bow', seed, 2).c.toFixed(3));
    assert.ok(cs.size > 40, 'merkez tohuma göre değişir');
});

test('indicatorAt: [0,1] üçgen dalga, periyodik, sürekli (kısıtlı eğim), negatif süre faz başı', () => {
    const s = A.makeAim('bow', 9, 2);
    const maxStep = 2 / s.periodMs * 10 + 1e-9;               // 10 ms'de en çok 2/periyot·10
    let prev = A.indicatorAt(s, 0);
    let min = 1; let max = 0;
    for (let t = 10; t <= 6000; t += 10) {
        const p = A.indicatorAt(s, t);
        assert.ok(p >= 0 && p <= 1);
        assert.ok(Math.abs(p - prev) <= maxStep, 'sürekli: ' + t);
        min = Math.min(min, p); max = Math.max(max, p);
        prev = p;
    }
    assert.ok(min < 0.02 && max > 0.98, 'tam aralığı süpürür');
    assert.ok(Math.abs(A.indicatorAt(s, 300) - A.indicatorAt(s, 300 + s.periodMs)) < 1e-9, 'periyodik');
    assert.equal(A.indicatorAt(s, -500), A.indicatorAt(s, 0));
});

test('resolve: kademe sınırları (merkez ≤ %25, bölge ≤ %65, kenar ≤ %100 yarı genişlik), dışı ve q<0/geçersiz ıska, kenar durumları', () => {
    const s = A.makeAim('bow', 3, 2);
    const at = (r) => s.c + r * s.half;
    assert.deepEqual([A.resolve(s, s.c).tier, A.resolve(s, s.c).dmg], ['merkez', 50]);
    assert.equal(A.resolve(s, at(0.25)).tier, 'merkez');
    assert.equal(A.resolve(s, at(-0.25)).tier, 'merkez');
    assert.equal(A.resolve(s, at(0.26)).tier, 'bolge');
    assert.equal(A.resolve(s, at(0.65)).tier, 'bolge');
    assert.equal(A.resolve(s, at(-0.66)).tier, 'kenar');
    assert.equal(A.resolve(s, at(1)).tier, 'kenar');
    assert.equal(A.resolve(s, at(1)).dmg, 15);
    assert.equal(A.resolve(s, at(1.01)).tier, 'iska');
    assert.equal(A.resolve(s, at(1.01)).dmg, 0);
    assert.deepEqual(A.resolve(s, -1), { tier: 'iska', dmg: 0, off: null });
    assert.equal(A.resolve(s, NaN).tier, 'iska');
    assert.equal(A.resolve(s, undefined).tier, 'iska');
    assert.equal(A.resolve(s, Infinity).tier === 'iska' || A.resolve(s, Infinity).tier === 'kenar', true);
    assert.equal(A.resolve(s, 5).dmg === A.resolve(s, 1).dmg, true, 'q [0,1]\'e kenetlenir');
    const edge = A.makeAim('bow', 11, 1);
    assert.ok(A.resolve(edge, 0).tier !== undefined && A.resolve(edge, 1).tier !== undefined);
    assert.ok(C.WEAPONS.bow.skill.tiers.every((t) => t.dmg <= 50), 'tek vuruş ≤ 50');
});

test('clampQ: q göstergenin ±slack penceresine kenetlenir; pencere içindeki q değişmez; başlangıçta (elapsed<slack) 0\'dan başlar', () => {
    const s = A.makeAim('bow', 21, 2);
    for (let e = 300; e < 3500; e += 137) {
        const p = A.indicatorAt(s, e);
        assert.equal(A.clampQ(s, p, e, 450), p, 'göstergenin kendisi değişmez');
        const lo = A.clampQ(s, -5, e, 450);
        const hi = A.clampQ(s, 5, e, 450);
        assert.ok(lo <= p && hi >= p && lo >= 0 && hi <= 1);
        // pencere tam yarım periyottan dar: uç değerler penceredeki min/max
        let mn = 1; let mx = 0;
        for (let t = e - 450; t <= e + 450; t += 5) { const v = A.indicatorAt(s, t); mn = Math.min(mn, v); mx = Math.max(mx, v); }
        assert.ok(Math.abs(lo - mn) < 0.02 && Math.abs(hi - mx) < 0.02, 'pencere sınırları');
    }
    assert.ok(A.clampQ(s, 0.999, 100, 450) <= 1);
    // dar pencerede (örn. 50 ms) q göstergeden en çok eğim·slack uzaklaşabilir
    const p0 = A.indicatorAt(s, 1000);
    assert.ok(Math.abs(A.clampQ(s, 1, 1000, 50) - p0) <= (2 / s.periodMs) * 55);
});

test('botQ: saf ve tohumlu; [0,1]; bölge merkezi etrafında Normal(0, AIM_REF_SIGMA) dağılımı; kimliğe göre farklı', () => {
    const s = A.makeAim('bow', 5, 3);
    assert.equal(A.botQ(5, 'bot1', s), A.botQ(5, 'bot1', s));
    assert.notEqual(A.botQ(5, 'bot1', s), A.botQ(5, 'bot2', s));
    let sum = 0; let sum2 = 0; let n = 0;
    for (let seed = 1; seed <= 4000; seed++) {
        const sp = A.makeAim('bow', seed, 1 + (seed % 5));
        const q = A.botQ(seed, 'bot' + (seed % 7), sp);
        assert.ok(q >= 0 && q <= 1);
        const e = q - sp.c;
        if (sp.c > 0.25 && sp.c < 0.75) { sum += e; sum2 += e * e; n++; }        // kenarlarda kenetleme yanlılık yaratmasın
    }
    const mean = sum / n;
    const sd = Math.sqrt(sum2 / n - mean * mean);
    assert.ok(Math.abs(mean) < 0.01, 'ortalama hata ≈ 0: ' + mean);
    assert.ok(Math.abs(sd - C.AIM_REF_SIGMA) < 0.01, 'sapma ≈ AIM_REF_SIGMA: ' + sd);
});

// ---- KALİBRASYON ----
test('KALİBRASYON (analitik): referans oyuncu (hata ~ N(0, 0.15)) ile d=1..5 ortalama beklenen yay hasarı 20 ± %10; yakın uzaktan belirgin kolay', () => {
    const e = [1, 2, 3, 4, 5].map((d) => A.dmgExpected('bow', d, C.AIM_REF_SIGMA));
    const avg = e.reduce((a, b) => a + b, 0) / 5;
    assert.ok(avg >= 18 && avg <= 22, 'ortalama ' + avg.toFixed(2) + ' (' + e.map((x) => x.toFixed(1)).join(' / ') + ')');
    for (let i = 1; i < 5; i++) assert.ok(e[i] < e[i - 1], 'uzaklaştıkça zorlaşır');
    assert.ok(e[0] > 2.5 * e[4], 'yakın (d=1) uzaktan (d=5) belirgin kolay: ' + (e[0] / e[4]).toFixed(2));
    assert.ok((e[0] + e[1]) / 2 > 1.8 * e[4], 'd≤2 ortalaması uzaktan belirgin yüksek');
    assert.ok(Math.max.apply(null, SK.tiers.map((t) => t.dmg)) <= 50, 'tek vuruş ≤ 50');
    assert.equal(A.dmgExpected('shotgun', 2, 0.15), null);
    // sigma sıfıra giderse hep merkez (50), büyürse sıfıra yaklaşır
    assert.ok(Math.abs(A.dmgExpected('bow', 3, 1e-6) - 50) < 1e-6);
    assert.ok(A.dmgExpected('bow', 3, 5) < 3);
});

test('KALİBRASYON (Monte-Carlo, tohum süpürmesi): botQ ile gerçek aim.js hattı d=1..5 ortalama hasar 20 ± %10 ve analitikle uyumlu', () => {
    const N = 6000;
    const per = [0, 0, 0, 0, 0];
    for (let d = 1; d <= 5; d++) {
        let sum = 0;
        for (let seed = 1; seed <= N; seed++) {
            const sp = A.makeAim('bow', seed * 7 + d, d);
            sum += A.resolve(sp, A.botQ(seed * 7 + d, 'ref' + (seed % 11), sp)).dmg;
        }
        per[d - 1] = sum / N;
    }
    const avg = per.reduce((a, b) => a + b, 0) / 5;
    assert.ok(avg >= 18 && avg <= 22, 'MC ortalama ' + avg.toFixed(2) + ' (' + per.map((x) => x.toFixed(1)).join(' / ') + ')');
    [1, 2, 3, 4, 5].forEach((d) => assert.ok(Math.abs(per[d - 1] - A.dmgExpected('bow', d, C.AIM_REF_SIGMA)) < 1.2, 'd=' + d + ' MC analitiğe uyar: ' + per[d - 1].toFixed(2) + ' / ' + A.dmgExpected('bow', d, C.AIM_REF_SIGMA).toFixed(2)));
    assert.ok(per[0] > 2.5 * per[4]);
    assert.ok(per[0] > per[1] && per[1] > per[2] && per[2] > per[3] && per[3] > per[4]);
});
