// Bomberman çizim yumuşatması: ızgara adımları ekranda ekran hızında (60 FPS) kayma olarak görünür (mantık değişmez).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../games/bomberman-smooth.js');

test('approach: hedefe yaklaşır, aşmaz; dt bölünse de aynı sonuç', () => {
    let v = 0;
    for (let i = 0; i < 100; i++) { const n = S.approach(v, 32, 16.67, S.TAU_MS); assert.ok(n >= v && n <= 32); v = n; }
    assert.ok(Math.abs(v - 32) < 1e-6, 'yakınsadı');
    const one = S.approach(0, 100, 40, 50);
    const two = S.approach(S.approach(0, 100, 15, 50), 100, 25, 50);
    assert.ok(Math.abs(one - two) < 1e-9, '15+25 ms == 40 ms (kare süresinden bağımsız)');
    assert.equal(S.approach(5, 5, 100, 50), 5);
    assert.equal(S.approach(0, 32, 0, 50), 0, 'dt 0: kıpırdamaz');
    assert.equal(S.approach(0, 32, -5, 50), 0, 'negatif dt yok sayılır');
});

test('150 ms adımda ~%95 ilerler; 32 px adım 60 FPS karelerinde çok sayıda ara konum üretir', () => {
    let st = { x: 0, y: 0, phase: 0, moving: false };
    const seen = [];
    for (let t = 0; t < 150; t += 16.67) { st = S.step(st, 32, 0, 16.67); seen.push(Math.round(st.x * 10) / 10); }
    assert.ok(st.x > 32 * 0.9, 'adım süresi dolmadan hedefe yakın: ' + st.x);
    assert.ok(new Set(seen).size >= 8, 'zıplama yok, ara konumlar var: ' + seen.join(','));
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], 'geri gitmez');
});

test('step: ilk görünüm ve uzak sıçrama (yeniden doğma/ışınlanma) anında; yakın hedef yumuşak', () => {
    assert.deepEqual(S.step(null, 96, 64, 16), { x: 96, y: 64, phase: 0, moving: false });
    const far = S.step({ x: 32, y: 32, phase: 5, moving: true }, 32 + S.SNAP_PX + 1, 32, 16);
    assert.equal(far.x, 32 + S.SNAP_PX + 1);
    assert.equal(far.phase, 0);
    const near = S.step({ x: 32, y: 32, phase: 0, moving: false }, 64, 32, 16);
    assert.ok(near.x > 32 && near.x < 64, 'bir hücre = yumuşak');
    assert.equal(S.shouldSnap(10, 10), false);
    assert.equal(S.shouldSnap(0, 65), true);
    assert.equal(S.shouldSnap(40, 0, 32), true);
});

test('step: hedefe yaklaşınca tam hedefe oturur (asimptot/titreme yok), durunca yürüme karesi sıfırlanır', () => {
    let st = { x: 0, y: 0, phase: 0, moving: false };
    let sawMoving = false;
    for (let i = 0; i < 80; i++) { st = S.step(st, 32, 0, 16.67); sawMoving = sawMoving || st.moving; }
    assert.ok(sawMoving);
    assert.equal(st.x, 32);
    assert.equal(st.moving, false);
    assert.equal(st.phase, 0);
    assert.equal(S.walkFrame(st.phase), 0, 'dururken ilk kare');
});

test('yürüme karesi görsel mesafeye bağlı: bir hücrelik adımda 0->1->2 döngüsü ilerler', () => {
    assert.equal(S.walkFrame(0), 0); assert.equal(S.walkFrame(0.99), 0); assert.equal(S.walkFrame(1), 1);
    assert.equal(S.walkFrame(2.5), 2); assert.equal(S.walkFrame(3), 0); assert.equal(S.walkFrame(-4), 0);
    let st = { x: 0, y: 0, phase: 0, moving: false };
    const frames = new Set();
    for (let i = 0; i < 12; i++) { st = S.step(st, 32, 0, 16.67); frames.add(S.walkFrame(st.phase)); }
    assert.ok(frames.size >= 2, 'bir adımda en az iki yürüme karesi görünür');
    assert.ok(st.phase > 0 || st.moving === false);
});

test('mapSignature: yalnız harita ya da extra değişince değişir (önbellek katmanı yenileme kararı)', () => {
    const m = [[1, 0, 2], [0, 1, 0], [3, 4, 0]];
    const a = S.mapSignature(m, 0);
    assert.equal(S.mapSignature(m.map((r) => r.slice()), 0), a, 'aynı içerik aynı imza');
    const m2 = m.map((r) => r.slice()); m2[1][2] = 2;
    assert.notEqual(S.mapSignature(m2, 0), a, 'bir hücre değişti');
    const m3 = m.map((r) => r.slice()); m3[0][0] = 0; m3[0][1] = 1;
    assert.notEqual(S.mapSignature(m3, 0), a, 'yer değiştirme farkı yakalanır');
    assert.notEqual(S.mapSignature(m, 1), a, 'sprite hazır olunca yeniden çizim');
    assert.equal(typeof a, 'number');
    assert.ok(a >= 0 && a <= 0xffffffff);
});

test('bomberman.js yumuşatmayı kullanır: modül oyundan önce yüklenir, görsel durum oyuncu nesnesinde değil kimlikte tutulur (ağa sızmaz)', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '..');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.indexOf('games/bomberman-smooth.js') > 0 && html.indexOf('games/bomberman-smooth.js') < html.indexOf('games/bomberman.js'));
    const src = fs.readFileSync(path.join(root, 'games', 'bomberman.js'), 'utf8');
    assert.ok(/BombermanSmooth\.step\(visById\[p\.id\]/.test(src), 'görsel konum kimlik anahtarlı');
    assert.ok(!/\._vis\b/.test(src), 'oyuncu nesnesine görsel durum yazılmaz (sendPosition tüm nesneyi ağa yollar)');
    assert.ok(/BombermanSmooth\.mapSignature/.test(src) && /drawMapCached\(\)/.test(src), 'statik harita katmanı önbellekli');
    assert.ok(/imageSmoothingEnabled = false/.test(src));
    const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8');
    assert.ok(/image-rendering:\s*pixelated/.test(css));
});
