const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../games/parti/graph.js');
const pirate = require('../games/parti/maps/pirate.js');
const space = require('../games/parti/maps/space.js');

for (const map of [pirate, space]) {
    test(map.name + ': harita geçerli (35-50 düğüm, döngüsel, dallanma, tek ortak başlangıç)', () => {
        assert.deepEqual(G.validate(map), []);
        const g = G.index(map);
        assert.equal(g.starts.length, 1, 'tek ortak başlangıç');
        assert.ok(g.byId[g.start].next.length >= 2, 'başlangıçtan ≥2 dal');
        assert.ok(map.nodes.filter((n) => n.next.length > 1).length >= 2);
        assert.ok(map.decor.length >= 20);
        assert.ok(map.nodes.filter((n) => n.type === 'treasure').length >= 4, 'sandık için yeterli hazine noktası');
    });
}

test('iki harita birbirinden farklı palet ve dekora sahip', () => {
    assert.notEqual(pirate.palette.bgTop, space.palette.bgTop);
    const pe = new Set(pirate.decor.map((d) => d.e));
    assert.ok(space.decor.every((d) => !pe.has(d.e)), 'ortak dekor emojisi yok');
});

test('doğrulayıcı hataları yakalar', () => {
    const bad = JSON.parse(JSON.stringify(pirate));
    bad.nodes[3].next = [];
    bad.nodes[4].next = [999];
    const errs = G.validate(bad);
    assert.ok(errs.some((e) => /çıkışsız/.test(e)));
    assert.ok(errs.some((e) => /bilinmeyen/.test(e)));
    const tiny = { nodes: [{ id: 0, x: 1, y: 1, type: 'normal', next: [0] }] };
    assert.ok(G.validate(tiny).length > 0);
});

// küçük elle yapılmış harita: 0 -> 1 -> (2 | 3) -> 4 -> 0
const mini = {
    nodes: [
        { id: 0, x: 0, y: 0, type: 'normal', next: [1] },
        { id: 1, x: 0, y: 0, type: 'normal', next: [2, 3] },
        { id: 2, x: 0, y: 0, type: 'normal', next: [4] },
        { id: 3, x: 0, y: 0, type: 'treasure', next: [4] },
        { id: 4, x: 0, y: 0, type: 'normal', next: [0] }
    ]
};

test('yürüme: tek yolda adım adım, geçilen düğümler sırayla', () => {
    const g = G.index(mini);
    const w = G.walk(g, 4, 1);
    assert.deepEqual(w, { path: [0], pos: 0, remaining: 0, choices: null });
    const w2 = G.walk(g, 4, 2);
    assert.deepEqual(w2.path, [0, 1]);
    assert.equal(w2.choices, null);       // 1'de tam adım bitti, seçim gerekmez
});

test('yürüme: dallanmada adım kalmışsa yön sorar; adım bitmişse sormaz', () => {
    const g = G.index(mini);
    const w = G.walk(g, 0, 4);
    assert.deepEqual(w.path, [1]);
    assert.equal(w.pos, 1);
    assert.equal(w.remaining, 3);
    assert.deepEqual(w.choices, [2, 3]);
    const via = G.walkVia(g, 1, 3, 3);
    assert.deepEqual(via.path, [3, 4, 0]);
    assert.equal(via.remaining, 0);
    assert.equal(G.walkVia(g, 1, 3, 4), null, 'çıkışı olmayan yön reddedilir');
});

test('mesafe: yön gözetmeden en kısa adım sayısı', () => {
    const g = G.index(mini);
    assert.equal(G.distance(g, 0, 4), 1);       // 4->0 kenarı yönsüz sayılır
    assert.equal(G.distance(g, 0, 0), 0);
    assert.equal(G.distance(g, 2, 3), 2);
    const map = G.index(pirate);
    const d = G.distance(map, 0, 15);
    assert.ok(d > 3 && Number.isFinite(d));
});

test('başlangıç kenarları ≤ 200 birim, başlangıç düğümleri başka düğümlerden ≥ 60 uzak (iki haritada)', () => {
    for (const map of [pirate, space]) {
        const g = G.index(map);
        map.nodes.filter((n) => n.type === 'start').forEach((n) => {
            n.next.forEach((to) => {
                const t = g.byId[to];
                assert.ok(Math.hypot(n.x - t.x, n.y - t.y) <= 200, map.id + ' başlangıç ' + n.id + ' kenarı uzun');
            });
            map.nodes.forEach((o) => {
                if (o.id !== n.id) assert.ok(Math.hypot(n.x - o.x, n.y - o.y) >= 60, map.id + ' ' + n.id + ' ' + o.id + ' yakın');
            });
        });
    }
});

test('doğrulayıcı: tek başlangıç, ≥2 dal, kısa kenar ve yakın düğüm kuralları yakalanır', () => {
    const long = JSON.parse(JSON.stringify(space));
    const st = long.nodes.find((n) => n.type === 'start');
    st.next = [1, long.nodes.find((n) => n.y < 100 && n.id !== 1).id];   // üst kenara çapraz uzun çizgiler
    assert.ok(G.validate(long).some((e) => /çok uzun/.test(e)));
    const one = JSON.parse(JSON.stringify(pirate));
    one.nodes.find((n) => n.type === 'start').next = [one.nodes.find((n) => n.type === 'start').next[0]];
    assert.ok(G.validate(one).some((e) => /en az 2 dal/.test(e)));
    const two = JSON.parse(JSON.stringify(pirate));
    two.nodes.push({ id: 900, x: 700, y: 650, type: 'start', next: [0, 1] });
    assert.ok(G.validate(two).some((e) => /tam 1 başlangıç/.test(e)));
    const close = JSON.parse(JSON.stringify(pirate));
    const start = close.nodes.find((n) => n.type === 'start');
    const other = close.nodes.find((n) => n.type === 'normal');
    other.x = start.x + 20; other.y = start.y;
    assert.ok(G.validate(close).some((e) => /yakın/.test(e)));
});

// ---- hareket önizlemesi ----
// 0 -> 1 -> (2 | 3);  2 -> 4 -> (5 | 6);  3 -> 7;  5,6,7 -> 8 -> 0
const forky = {
    nodes: [
        { id: 0, x: 0, y: 0, type: 'normal', next: [1] },
        { id: 1, x: 0, y: 0, type: 'normal', next: [2, 3] },
        { id: 2, x: 0, y: 0, type: 'normal', next: [4] },
        { id: 3, x: 0, y: 0, type: 'treasure', next: [7] },
        { id: 4, x: 0, y: 0, type: 'normal', next: [5, 6] },
        { id: 5, x: 0, y: 0, type: 'normal', next: [8] },
        { id: 6, x: 0, y: 0, type: 'normal', next: [8] },
        { id: 7, x: 0, y: 0, type: 'normal', next: [8] },
        { id: 8, x: 0, y: 0, type: 'normal', next: [0] }
    ]
};

test('önizleme: her çıkış için yol ve bitiş; tek adımda bitiş = ilk düğüm', () => {
    const g = G.index(forky);
    const p = G.preview(g, 1, 1);
    assert.deepEqual(p.map((x) => x.choice), [2, 3]);
    assert.deepEqual(p.map((x) => x.path), [[2], [3]]);
    assert.deepEqual(p.map((x) => x.ends), [[2], [3]]);
    assert.deepEqual(p.map((x) => x.more), [false, false]);
});

test('önizleme: adım yetiyorsa yol sonraki dallanmada durur ve olası tüm bitişler listelenir', () => {
    const g = G.index(forky);
    const p = G.preview(g, 1, 3);
    const a = p.find((x) => x.choice === 2);
    assert.deepEqual(a.path, [2, 4], 'ilk dallanma düğümünde durur');
    assert.equal(a.more, true);
    assert.deepEqual(a.ends.slice().sort(), [5, 6], 'iç içe dal: 1 adım kaldı, iki olası bitiş');
    const b = p.find((x) => x.choice === 3);
    assert.deepEqual(b.path, [3, 7, 8]);
    assert.deepEqual(b.ends, [8]);
    assert.equal(b.more, false);
    // daha çok adım: iki dal aynı düğümde birleşir (tekil bitiş)
    const p4 = G.preview(g, 1, 4).find((x) => x.choice === 2);
    assert.deepEqual(p4.ends, [8]);
});

test('önizleme: adım dallanma düğümünde biterse bitiş o düğümdür; adım yoksa boş', () => {
    const g = G.index(forky);
    const a = G.preview(g, 1, 2).find((x) => x.choice === 2);
    assert.deepEqual(a.path, [2, 4]);
    assert.deepEqual(a.ends, [4]);
    assert.equal(a.more, false, 'adım bitti, yeni seçim gerekmez');
    assert.deepEqual(G.preview(g, 1, 0), []);
    assert.deepEqual(G.preview(g, 999, 3), []);
});

test('önizleme: gerçek yürüyüşle tutarlı (rastgele devam seçimleriyle bitiş her zaman ends içinde, yol önek)', () => {
    for (const map of [pirate, space, forky]) {
        const g = G.index(map);
        const branches = map.nodes.filter((n) => n.next.length > 1);
        for (const b of branches) {
            for (let steps = 1; steps <= 6; steps++) {
                const pv = G.preview(g, b.id, steps);
                assert.equal(pv.length, b.next.length);
                pv.forEach((entry) => {
                    assert.ok(entry.path.length >= 1 && entry.path.length <= steps);
                    assert.equal(entry.path[0], entry.choice);
                    const w = G.walkVia(g, b.id, steps, entry.choice);
                    assert.deepEqual(w.path, entry.path, 'önizleme yolu = gerçek yol');
                    // her olası devam ends içinde biter
                    (function explore(cur, depth) {
                        if (!cur.choices) { assert.ok(entry.ends.includes(cur.pos), map.nodes.length + ' b' + b.id + ' s' + steps + ' son ' + cur.pos); return; }
                        cur.choices.forEach((c) => explore(G.walkVia(g, cur.pos, cur.remaining, c), depth + 1));
                    })(w, 0);
                });
            }
        }
    }
});
