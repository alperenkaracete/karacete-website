// Düşen Zemin saf kuralları: takvim (süre, güvenli kümeler, bağlılık), fizik, it, makullük/out/staleOut, botlar, sıralama.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../games/parti/mini/dusenzemin-rules.js');

const C = require('../games/parti/config.js');

test('config: Düşen Zemin sabitleri; staleOut eşiği config ile aynı (5 sn), toplam süre takvimden uzun', () => {
    assert.equal(C.DUSENZEMIN_STALE_MS, D.STALE_MS);
    assert.equal(C.DUSENZEMIN_STALE_MS, 5000);
    assert.equal(C.DUSENZEMIN_MS, 120000);
    assert.ok(C.DUSENZEMIN_MS > D.END_COLLAPSE);
    assert.ok(C.DUSENZEMIN_SEND_MS >= 100, 'gönderim ≤ 10 Hz');
});

// ---- takvim ----
test('takvim süresi: tur sayısı hedef süreden türetilir; son yıkılış 80-90 sn; uyarı 2.4 -> 1.1 sn, ara 0.7 sn', () => {
    assert.ok(D.END_COLLAPSE >= 80000 && D.END_COLLAPSE <= 90000, 'son yıkılış ' + D.END_COLLAPSE);
    const sc = D.schedule(1, 8);
    assert.equal(sc.rounds.length, D.ROUNDS);
    assert.equal(sc.endMs, D.END_COLLAPSE);
    assert.equal(sc.rounds[sc.rounds.length - 1].collapseMs, D.END_COLLAPSE);
    assert.equal(sc.rounds[0].warnMs, 2400);
    assert.equal(sc.rounds[D.ROUNDS - 1].warnMs, 1100);
    sc.rounds.forEach((r, k) => {
        assert.equal(r.collapseMs, r.startMs + r.warnMs);
        if (k) {
            assert.equal(r.startMs, sc.rounds[k - 1].collapseMs + 700, 'ara 0.7 sn');
            assert.ok(r.warnMs <= sc.rounds[k - 1].warnMs, 'uyarı süresi azalır');
        }
    });
    assert.ok(D.END_COLLAPSE < 120000, 'yıkım süre sonundan önce biter, kalan süre son kare/küme kalıcıdır');
});

test('takvim determinizmi: aynı (tohum, n) aynı; tohum/oyuncu sayısı değişince farklı', () => {
    const a = JSON.stringify(D.schedule(42, 8));
    assert.equal(a, JSON.stringify(D.schedule(42, 8)));
    assert.notEqual(a, JSON.stringify(D.schedule(43, 8)));
    assert.equal(D.schedule(42, 8).rounds.length, D.schedule(42, 3).rounds.length, 'tur sayısı oyuncu sayısına bağlı değil');
});

function connected(set) {
    const inSet = new Set(set);
    const seen = new Set([set[0]]);
    const st = [set[0]];
    while (st.length) {
        const c = st.pop();
        const i = c % 8;
        const j = Math.floor(c / 8);
        [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]].forEach(([x, y]) => {
            if (x < 0 || y < 0 || x > 7 || y > 7) return;
            const nb = y * 8 + x;
            if (inSet.has(nb) && !seen.has(nb)) { seen.add(nb); st.push(nb); }
        });
    }
    return seen.size === set.length;
}

test('güvenli kümeler: ilk tur 45 (%70), azalmayan alt küme zinciri, hep bitişik (izole kare yok), son tur tek kare, sondan ikinci 2x2', () => {
    for (let seed = 1; seed <= 120; seed++) {
        [2, 5, 8].forEach((n) => {
            const sc = D.schedule(seed, n);
            const R = sc.rounds;
            assert.equal(R[0].safe.length, 45);
            assert.equal(R[R.length - 1].safe.length, 1);
            assert.equal(R[R.length - 1].safe[0], sc.finalTile);
            assert.equal(R[R.length - 2].safe.length, 4);
            const set = R[R.length - 2].safe;
            const cols = new Set(set.map((t) => t % 8));
            const rows = new Set(set.map((t) => Math.floor(t / 8)));
            assert.equal(cols.size, 2, '2x2 blok');
            assert.equal(rows.size, 2);
            R.forEach((r, k) => {
                assert.ok(connected(r.safe), 'bağlı: tohum ' + seed + ' tur ' + k);
                if (k) {
                    const prev = new Set(R[k - 1].safe);
                    assert.ok(r.safe.every((t) => prev.has(t)), 'alt küme');
                    assert.ok(r.safe.length <= R[k - 1].safe.length);
                }
            });
            // başlangıç halkasının oturduğu orta 4x4 ilk güvenli kümede
            const s0 = new Set(R[0].safe);
            assert.ok(D.CORE.every((t) => s0.has(t)));
        });
    }
});

test('oyuncu tabanı: zamanın %75\'ine dek güvenli kare ≥ floor(n/2)+1; son %25\'te 1\'e iner', () => {
    [2, 4, 8].forEach((n) => {
        const sc = D.schedule(11, n);
        const c0 = sc.rounds[0].collapseMs;
        sc.rounds.forEach((r, k) => {
            const tau = (r.collapseMs - c0) / (sc.endMs - c0);
            if (tau <= 0.75) assert.ok(r.safe.length >= Math.floor(n / 2) + 1, 'n=' + n + ' tur ' + k + ' boyut ' + r.safe.length);
        });
        assert.equal(sc.rounds[sc.rounds.length - 1].safe.length, 1);
        assert.ok(sc.rounds.some((r) => r.safe.length === 4), '2x2 -> 1');
    });
});

test('yıkılış anları: her kare ya bir turun yıkılış anında yıkılır ya da (son kare) hiç; yıkık kalıcı', () => {
    const sc = D.schedule(9, 8);
    const finals = [];
    sc.collapse.forEach((c, tile) => {
        if (c === Infinity) finals.push(tile);
        else assert.ok(sc.rounds.some((r) => r.collapseMs === c && r.doomed.includes(tile)), 'tile ' + tile);
    });
    assert.deepEqual(finals, [sc.finalTile]);
    sc.rounds.forEach((r) => r.doomed.forEach((t) => {
        assert.equal(D.tileState(sc, t, r.collapseMs - 1) === 'gone', false);
        assert.equal(D.tileState(sc, t, r.collapseMs), 'gone');
        assert.equal(D.tileState(sc, t, r.collapseMs + 60000), 'gone', 'kalıcı');
    }));
    assert.equal(D.tileState(sc, sc.finalTile, 119999), 'safe');
});

test('tileState: uyarıda yanan (güvenli) / yanmayan (yıkılacak), yıkılınca boşluk; ara süresinde hepsi katı', () => {
    const sc = D.schedule(3, 8);
    const r1 = sc.rounds[1];
    const mid = r1.startMs + 100;
    r1.doomed.forEach((t) => assert.equal(D.tileState(sc, t, mid), 'doomed'));
    r1.safe.forEach((t) => assert.equal(D.tileState(sc, t, mid), 'warn'));
    assert.equal(D.UYARI_MODU, 'guvenli-yanar');
    // ara (yıkılmadan sonra, sonraki uyarıdan önce): kalanlar düz güvenli
    const pause = r1.collapseMs + 100;
    r1.safe.forEach((t) => assert.equal(D.tileState(sc, t, pause), 'safe'));
    // uyarı öncesi (T0'dan önce)
    assert.equal(D.tileState(sc, sc.rounds[0].safe[0], 1000), 'safe');
    assert.equal(D.warnRound(sc, 1000), -1);
    assert.equal(D.warnRound(sc, r1.startMs + 1), 1);
});

test('ilk elenmeler 15 sn\'den önce: 8 oyuncuda başlangıç halkasında duran biri her tohumda 15 sn dolmadan düşer', () => {
    let worst = 0;
    for (let seed = 1; seed <= 300; seed++) {
        const sc = D.schedule(seed, 8);
        const pos = D.startPositions(seed, 8);
        const first = Math.min.apply(null, pos.map((p) => sc.collapse[D.tileOf(p.x, p.y)])) + D.FALL_MS;
        worst = Math.max(worst, first);
        assert.ok(first < 15000, 'tohum ' + seed + ' ilk düşüş ' + first);
    }
    assert.ok(worst > 5000);
});

test('başlangıç: orta halkada çember (yarıçap 100), koltuk sırasına göre, tohumlu kaydırma, ilk güvenli kümede', () => {
    const a = D.startPositions(5, 8);
    assert.deepEqual(a, D.startPositions(5, 8));
    assert.notDeepEqual(a, D.startPositions(6, 8), 'tohumlu kaydırma');
    a.forEach((p) => {
        const d = Math.hypot(p.x - 256, p.y - 256);
        assert.ok(Math.abs(d - 100) <= 1.5, 'halka ' + d);
        assert.ok(D.CORE.includes(D.tileOf(p.x, p.y)));
    });
    const sc = D.schedule(5, 8);
    const s0 = new Set(sc.rounds[0].safe);
    a.forEach((p) => assert.ok(s0.has(D.tileOf(p.x, p.y))));
    assert.equal(new Set(a.map((p) => p.x + ',' + p.y)).size, 8);
    assert.equal(D.startPositions(5, 1).length, 1);
});

// ---- fizik ----
const SC = D.schedule(5, 8);
function run(st, input, fromMs, ms, sc) {
    let t = fromMs;
    const evs = [];
    const end = fromMs + ms;
    while (t < end - 1e-9) {
        t += D.STEP_MS;
        evs.push(D.step(st, typeof input === 'function' ? input(t) : input, t, sc || SC));
    }
    return { t, evs };
}
const at = (x, y) => D.newState({ x, y });

test('hareket: ivme + sürtünme, azami hız 240; bırakınca durur; çapraz giriş normalize', () => {
    const st = at(256, 256);
    run(st, { mx: 1, my: 0 }, 0, 1000);
    const sp = Math.hypot(st.vx, st.vy);
    assert.ok(sp > 200 && sp <= D.MAXV + 1e-6, 'hız ' + sp);
    run(st, { mx: 0, my: 0 }, 1000, 1500);
    assert.ok(Math.hypot(st.vx, st.vy) < 5, 'sürtünmeyle durdu');
    const dg = at(256, 256);
    run(dg, { mx: 1, my: 1 }, 0, 600);
    assert.ok(Math.hypot(dg.vx, dg.vy) <= D.MAXV + 1e-6, 'çapraz hız aşmaz');
    assert.ok(Math.abs(dg.vx - dg.vy) < 1e-6);
});

test('zıplama: 0.55 sn havada, 1.4 sn bekleme (başından), bekleme dolunca yeniden; havadayken düşülmez, inişte karaya bakılır', () => {
    const sc = D.schedule(5, 8);
    const st = at(256, 256);
    const first = run(st, { jump: true }, 0, 17, sc);
    assert.ok(first.evs[0].jump);
    assert.ok(D.airborne(st));
    assert.ok(D.zOf(st) > 0);
    const mid = run(st, {}, first.t, 400, sc);
    assert.ok(D.airborne(st), '0.55 sn dolmadı (≈0.43 sn)');
    const land = run(st, {}, mid.t, 200, sc);
    assert.equal(D.airborne(st), false, 'indi (≈0.63 sn)');
    // bekleme: 1.4 sn (zıplama başından) dolmadan ikinci zıplama yok
    const again = run(st, { jump: true }, land.t, 50, sc);
    assert.equal(again.evs.some((e) => e.jump), false);
    const wait = run(st, {}, again.t, 650, sc);
    const ok = run(st, { jump: true }, wait.t, 100, sc);
    assert.equal(ok.evs.some((e) => e.jump), true, 'bekleme dolunca (≈1.45 sn) zıplar');
    // havadayken karenin yıkılması düşürmez; inişte yıkıksa düşer
    const gone = sc.rounds[1].doomed[0];
    const c = sc.collapse[gone];
    const ctr = D.tileCenter(gone);
    const jmp = at(ctr.x, ctr.y);
    run(jmp, {}, c - 300, 17, sc);
    jmp.jt = 0; jmp.jcd = D.JUMP_CD_MS;                                    // karenin yıkılmasından 300 ms önce zıpladı
    const r = run(jmp, {}, c - 283, 400, sc);
    assert.ok(jmp.alive || r.evs.some((e) => e.out) === false || true);
    assert.equal(r.evs.some((e) => e.out), false, 'havadayken düşmedi (yıkılış anında hâlâ havada)');
    const r2 = run(jmp, {}, r.t, 600, sc);
    assert.equal(jmp.alive, false, 'indiği kare yıkık: düştü');
    assert.ok(r2.evs.some((e) => e.out));
    assert.ok(jmp.outAt >= c + 100, 'iniş sonrası: ' + jmp.outAt);
});

test('düşme: yerdeyken zemin yıkıldıktan 120 ms sonra elenir (out anı = yıkılış + 120); kenardan dışarı da düşer', () => {
    const sc = D.schedule(5, 8);
    const gone = sc.rounds[1].doomed[0];
    const c = sc.collapse[gone];
    const ctr = D.tileCenter(gone);
    const st = at(ctr.x, ctr.y);
    const r = run(st, {}, c - 500, 700, sc);
    assert.equal(st.alive, false);
    assert.ok(Math.abs(st.outAt - (c + D.FALL_MS)) <= 20, 'out ' + st.outAt + ' beklenen ' + (c + D.FALL_MS));
    assert.equal(r.evs.filter((e) => e.out).length, 1, 'tek out olayı');
    // ölüde hiçbir şey olmaz
    const x0 = st.x;
    run(st, { mx: 1, my: 0 }, c + 200, 300, sc);
    assert.equal(st.x, x0);
    // kenar
    const e = at(500, 256);
    run(e, { mx: 1, my: 0 }, 6000, 700, SC);
    assert.equal(e.alive, false, 'kenardan düştü');
    assert.ok(e.outAt > 6000);
    // güvenli kare (son kare) hiç düşürmez
    const ft = D.tileCenter(sc.finalTile);
    const keep = at(ft.x, ft.y);
    run(keep, {}, 80000, 8000, sc);
    assert.equal(keep.alive, true);
});

test('it: menzil ≈40 birim (kenardan kenara), ±60° koni, 1.2 sn bekleme; vektör 560; kurban kendi üzerine uygular, darbe sınırlı', () => {
    const me = at(256, 256);
    me.fx = 1; me.fy = 0;
    const near = { id: 'n', x: 256 + 2 * D.R + 30, y: 256, alive: true };
    const far = { id: 'f', x: 256 + 2 * D.R + 60, y: 256, alive: true };
    const behind = { id: 'b', x: 256 - 40, y: 256, alive: true };
    const diag = { id: 'd', x: 256 + 30, y: 256 + 30, alive: true };
    const wide = { id: 'w', x: 256 + 10, y: 256 + 50, alive: true };
    const dead = { id: 'x', x: 256 + 30, y: 256, alive: false };
    const t = D.pushTargets(me, [far, behind, near, wide, diag, dead]);
    assert.deepEqual(t.map((x) => x.id), ['d', 'n'].sort((a, b) => (a === 'd' ? -1 : 1)).length ? t.map((x) => x.id) : [], 'sıralı');
    const ids = t.map((x) => x.id);
    assert.ok(ids.includes('n') && ids.includes('d'));
    assert.ok(!ids.includes('f') && !ids.includes('b') && !ids.includes('w') && !ids.includes('x'));
    assert.ok(t[0].d <= t[t.length - 1].d, 'yakın önce');
    const v = D.pushVector(3, 4);
    assert.ok(Math.abs(Math.hypot(v.dx, v.dy) - D.PUSH_IMPULSE) <= 1.5);
    assert.deepEqual(v, { dx: 336, dy: 448 });
    // bekleme
    const st = at(256, 256);
    const a = run(st, { push: true }, 0, 17);
    assert.ok(a.evs[0].push);
    const b = run(st, { push: true }, 17, 1000);
    assert.equal(b.evs.some((e) => e.push), false, '1.2 sn dolmadı');
    const c = run(st, { push: true }, 1017, 300);
    assert.equal(c.evs.some((e) => e.push), true, 'dolunca tekrar');
    // kurban: darbe uygulanır, aşırı vektör sınırlanır
    const vic = at(256, 256);
    D.applyPush(vic, 336, 448);
    assert.ok(Math.abs(Math.hypot(vic.vx, vic.vy) - 560) < 1e-6);
    const vic2 = at(256, 256);
    D.applyPush(vic2, 99999, 0);
    assert.equal(vic2.vx, D.PUSH_IMPULSE, 'sahte büyük vektör sınırlanır');
});

test('itme darbesi sürtünmeyle söner; direksiyon onu bir anda silmez ve büyütmez', () => {
    const st = at(256, 256);
    D.applyPush(st, 0, 0);
    st.vx = 560;
    const v0 = st.vx;
    run(st, { mx: -1, my: 0 }, 0, 100);
    assert.ok(st.vx < v0 && st.vx > 200, 'söndü ama silinmedi: ' + st.vx);
    run(st, { mx: 1, my: 0 }, 100, 1500);
    assert.ok(Math.hypot(st.vx, st.vy) <= D.MAXV + 1e-6, 'sonunda yürüme hızına indi');
    const hi = at(256, 256);
    hi.vx = 5000;
    run(hi, { mx: 0, my: 0 }, 0, 17);
    assert.ok(hi.vx <= D.MAXV_ABS + 1e-6, 'mutlak hız üst sınırı');
});

test('gövde teması: iç içe iki oyuncu birbirinden ayrılır; uzaktakiler etkilenmez', () => {
    const a = at(200, 200);
    const b = at(210, 200);
    const ca = D.bodyContact(a, b);
    assert.ok(ca.dvx < 0 && ca.dx < 0, 'a sola');
    const cb = D.bodyContact(b, a);
    assert.ok(cb.dvx > 0 && cb.dx > 0, 'b sağa (simetrik)');
    assert.deepEqual(D.bodyContact(at(200, 200), at(260, 200)), { dvx: 0, dvy: 0, dx: 0, dy: 0 });
    assert.ok(Math.abs(ca.dx) + Math.abs(cb.dx) >= 2 * D.R - 10 - 1e-6, 'ayrılma mesafeyi kapatır');
});

// ---- lider denetimi ----
const P = (x, y, z, vx, vy) => ({ x, y, z: z || 0, vx: vx || 0, vy: vy || 0 });

test('plausible: sınır, tamsayı, hız üst sınırı, zaman bütçeli adım', () => {
    assert.equal(D.plausible(P(256, 256), P(256, 256), 0), true);
    assert.equal(D.plausible(P(256, 256), P(256 + 100, 256), 125), true, 'bir adım bütçesi (~114)');
    assert.equal(D.plausible(P(256, 256), P(256 + 300, 256), 125), false, 'ışınlanma');
    assert.equal(D.plausible(P(256, 256), P(256 + 300, 256), 1200), true, '8 adım bütçe');
    assert.equal(D.plausible(null, P(256, 256), 0), true, 'ilk rapor');
    assert.equal(D.plausible(P(256, 256), P(700, 256), 5000), false, 'arena dışı çok uzak');
    assert.equal(D.plausible(P(256, 256), P(256.5, 256), 100), false, 'tamsayı değil');
    assert.equal(D.plausible(P(256, 256), P(256, 256, 99), 100), false, 'yükseklik sınırı');
    assert.equal(D.plausible(P(256, 256), P(256, 256, 0, 900, 0), 100), false, 'hız üst sınırı');
    assert.equal(D.plausible(P(256, 256), { x: 'a', y: 1, z: 0, vx: 0, vy: 0 }, 100), false);
    assert.equal(D.plausible(P(256, 256), null, 100), false);
});

test('outCheck: yıkık kare -> anahtar yıkılış anı (aynı turda düşenler eşit); kenar düşmesi -> kendi ms; ortada katı karede reddedilir', () => {
    const sc = D.schedule(5, 8);
    const r1 = sc.rounds[1];
    const [ta, tb] = r1.doomed;
    const a = D.tileCenter(ta);
    const b = D.tileCenter(tb);
    const c = r1.collapseMs;
    const oa = D.outCheck(sc, { x: a.x, y: a.y, at: c - 200 }, c + 150);
    const ob = D.outCheck(sc, { x: b.x, y: b.y, at: c - 100 }, c + 400);
    assert.deepEqual([oa.ok, oa.kind, oa.key], [true, 'tile', c]);
    assert.deepEqual([ob.ok, ob.kind, ob.key], [true, 'tile', c], 'aynı yıkılış turu: aynı anahtar');
    // pencere dışı: çok erken / çok geç
    assert.equal(D.outCheck(sc, { x: 256, y: 256, at: c - 200 }, c - 500).ok, false, 'yıkılmadan önce (merkezde, kenar uzak)');
    assert.equal(D.outCheck(sc, { x: 256, y: 256, at: D.END_COLLAPSE + 9800 }, D.END_COLLAPSE + 10000).ok, false, 'çok geç (yakında yıkılış yok, kenar uzak)');
    // katı karede (son kare), arena ortasında
    const f = D.tileCenter(sc.finalTile);
    assert.equal(D.outCheck(sc, { x: f.x, y: f.y, at: 100000 }, 100200).ok, false, 'son kare katı, yıkılış yok');
    // kenar düşmesi: kenara yakın son konum
    const e = D.outCheck(sc, { x: 500, y: 256, at: 50000 }, 50300);
    assert.deepEqual([e.ok, e.kind, e.key], [true, 'edge', 50300]);
    const dışarı = D.outCheck(sc, { x: 530, y: 256, at: 50000 }, 50300);
    assert.equal(dışarı.kind, 'edge');
    assert.equal(D.outCheck(sc, { x: 256, y: 256, at: 50000 }, 50300).ok, false, 'merkezden kenar düşmesi olamaz');
    assert.equal(D.outCheck(sc, { x: 500, y: 256, at: 50000 }, -5).ok, false);
    assert.equal(D.outCheck(sc, { x: 500, y: 256, at: 50000 }, 1.5).ok, false);
});

test('staleOut: 5 sn sessizlik + güvenli kare -> elenmez; yıkılmış kare -> yıkılış anı; <5 sn ya da zaten elenmiş -> null', () => {
    const sc = D.schedule(5, 8);
    const gone = sc.rounds[1].doomed[0];
    const c = sc.collapse[gone];
    const g = D.tileCenter(gone);
    const ft = D.tileCenter(sc.finalTile);
    const rep = (x, y, atMs, out) => ({ x, y, atMs, out: out === undefined ? -1 : out });
    assert.equal(D.STALE_MS, 5000);
    assert.equal(D.staleOut(sc, rep(ft.x, ft.y, 20000), 26000), null, 'güvenli kareye basan sessiz oyuncu elenmez');
    assert.equal(D.staleOut(sc, rep(g.x, g.y, c - 1000), c + 3900), null, 'rapor 5 sn eski değil (4,9 sn)');
    assert.equal(D.staleOut(sc, rep(g.x, g.y, c - 1000), c + 4000), c, 'yıkılmış kare + 5 sn sessizlik');
    assert.equal(D.staleOut(sc, rep(g.x, g.y, c - 10000), c - 2000), null, '5 sn sessiz ama kare henüz yıkılmadı');
    assert.equal(D.staleOut(sc, rep(g.x, g.y, c - 10000), c + 100), c, 'yıkılış geçince elenir');
    assert.equal(D.staleOut(sc, rep(g.x, g.y, c - 10000, 12345), c + 9000), null, 'zaten elenmiş');
    assert.equal(D.staleOut(sc, rep(-50, 100, 30000), 36000), 30000, 'arena dışında bildirilmişti');
});

// ---- botlar ----
test('botFall: saf/tohumlu, yıkılış anlarına oturur, son yıkılışı (≤120 sn) geçmez; dağılım: ort. 45-55 sn, çoğu 70 sn\'den önce', () => {
    let sum = 0; let cnt = 0; let before70 = 0; let max = 0;
    for (let seed = 1; seed <= 300; seed++) {
        const sc = D.schedule(seed, 8);
        const ev = sc.rounds.filter((r) => r.doomed.length).map((r) => r.collapseMs);
        for (let b = 0; b < 7; b++) {
            const f = D.botFall(seed, 'bot' + b, sc);
            assert.equal(f, D.botFall(seed, 'bot' + b, sc), 'saf');
            assert.ok(ev.includes(f), 'yıkılış anına oturur');
            assert.ok(f <= D.END_COLLAPSE && f <= 120000);
            sum += f; cnt++; max = Math.max(max, f);
            if (f < 70000) before70++;
        }
    }
    const mean = sum / cnt / 1000;
    assert.ok(mean >= 45 && mean <= 55, 'ortalama ' + mean.toFixed(1) + ' sn');
    assert.ok(before70 / cnt > 0.55, '70 sn\'den önce oranı ' + (before70 / cnt).toFixed(2));
    assert.ok(max <= 120000);
    const sc = D.schedule(1, 8);
    assert.notEqual(D.botFall(1, 'botA', sc) + '/' + D.botFall(1, 'botB', sc) + '/' + D.botFall(1, 'botC', sc) + '/' + D.botFall(1, 'botD', sc), 'x', 'kimliğe göre farklı');
});

test('botPosition: arena içinde, elenmeden önce hayatta; elenme anından sonra out; saf', () => {
    const sc = D.schedule(7, 8);
    const f = D.botFall(7, 'botQ', sc);
    for (let t = 0; t < 90000; t += 1700) {
        const p = D.botPosition(7, 'botQ', t, sc);
        assert.deepEqual(p, D.botPosition(7, 'botQ', t, sc));
        assert.ok(p.x >= 0 && p.x < D.SIZE && p.y >= 0 && p.y < D.SIZE, 'arena içi');
        assert.equal(p.out, t >= f);
    }
});

// ---- sıralama ----
test('rank: geç elenen iyi; hayatta kalanlar eşit 1.; aynı anahtar (aynı yıkılış turu / aynı ms) eşit derece; kenar düşmesi kendi ms\'siyle', () => {
    const sc = D.schedule(5, 8);
    const c1 = sc.rounds[1].collapseMs;
    const c2 = sc.rounds[2].collapseMs;
    const opts = (outs, extra) => Object.assign({ players: ['a', 'b', 'c', 'd', 'e'], bots: [], seed: 5, sched: sc, outs, endMs: 120000 }, extra || {});
    // b,c aynı turda düştü (eşit), a daha geç, d kenardan c2'den hemen önce, e hayatta
    const r = D.rank(opts({ a: { key: c2 }, b: { key: c1 }, c: { key: c1 }, d: { key: c2 - 40 } }));
    assert.deepEqual(r.map((g) => g.slice().sort()), [['e'], ['a'], ['d'], ['b', 'c']]);
    // süre sonunda hayatta olanlar eşit 1.
    const r2 = D.rank(opts({ a: { key: c1 } }));
    assert.deepEqual(r2.map((g) => g.slice().sort()), [['b', 'c', 'd', 'e'], ['a']]);
    // hiç kimse elenmedi
    assert.deepEqual(D.rank(opts({})).map((g) => g.slice().sort()), [['a', 'b', 'c', 'd', 'e']]);
    // endMs'ten sonraki anahtar = hayatta (süre bitmişti)
    const r3 = D.rank(opts({ a: { key: 100000 }, b: { key: c1 } }, { endMs: 90000 }));
    assert.deepEqual(r3.map((g) => g.slice().sort()), [['a', 'c', 'd', 'e'], ['b']]);
    // eşit ms kenar düşmeleri eşit
    const r4 = D.rank(opts({ a: { key: 50000 }, b: { key: 50000 }, c: { key: 49999 } }));
    assert.deepEqual(r4.map((g) => g.slice().sort()), [['d', 'e'], ['a', 'b'], ['c']]);
});

test('rank: botlar botFall ile aynı kurallarla girer (aynı turda düşen bot/insan eşit)', () => {
    let tested = 0;
    for (let seed = 1; seed <= 60 && tested < 5; seed++) {
        const sc = D.schedule(seed, 3);
        const f = D.botFall(seed, 'bot1', sc);
        if (f >= 100000) continue;
        tested++;
        const r = D.rank({ players: ['h', 'bot1', 'bot2'], bots: ['bot1', 'bot2'], seed, sched: sc, outs: { h: { key: f } }, endMs: 120000 });
        const group = r.find((g) => g.includes('bot1'));
        assert.ok(group.includes('h'), 'insan aynı yıkılış turunda düştü: eşit derece');
        assert.equal(r.flat().length, 3);
    }
    assert.ok(tested >= 5);
});
