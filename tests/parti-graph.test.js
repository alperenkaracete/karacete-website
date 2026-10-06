const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../games/parti/graph.js');
const pirate = require('../games/parti/maps/pirate.js');
const space = require('../games/parti/maps/space.js');

for (const map of [pirate, space]) {
    test(map.name + ': harita geçerli (35-50 düğüm, döngüsel, dallanma, 8 başlangıç)', () => {
        assert.deepEqual(G.validate(map), []);
        const g = G.index(map);
        assert.ok(g.starts.length >= 8);
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
