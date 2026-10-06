// Parti: tahta grafı. Saf, DOM'suz. Haritalar veri olarak verilir (games/parti/maps/*.js), mantık haritadan bağımsızdır.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.PartiGraph = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var TYPES = ['normal', 'start', 'treasure', 'weapon', 'event'];

    // map: { id, nodes: [{id, x, y, type, next: [id]}], decor }
    function index(map) {
        var byId = {};
        var undirected = {};
        var starts = [];
        map.nodes.forEach(function (n) { byId[n.id] = n; undirected[n.id] = []; if (n.type === 'start') starts.push(n.id); });
        map.nodes.forEach(function (n) {
            n.next.forEach(function (to) {
                if (!byId[to]) return;
                if (undirected[n.id].indexOf(to) < 0) undirected[n.id].push(to);
                if (undirected[to].indexOf(n.id) < 0) undirected[to].push(n.id);
            });
        });
        return { map: map, byId: byId, undirected: undirected, starts: starts, cache: {} };
    }

    // Tahtadaki en kısa adım sayısı (yön gözetmeden: menzil için); ulaşılamazsa Infinity
    function distances(g, from) {
        if (g.cache[from]) return g.cache[from];
        var d = {};
        d[from] = 0;
        var queue = [from];
        for (var h = 0; h < queue.length; h++) {
            var cur = queue[h];
            var adj = g.undirected[cur] || [];
            for (var i = 0; i < adj.length; i++) {
                if (d[adj[i]] === undefined) { d[adj[i]] = d[cur] + 1; queue.push(adj[i]); }
            }
        }
        g.cache[from] = d;
        return d;
    }

    function distance(g, a, b) {
        var d = distances(g, a)[b];
        return d === undefined ? Infinity : d;
    }

    // `steps` adım yürür; dallanmada (>1 çıkış) ve adım kaldıysa durur ve seçenekleri verir.
    // Dönen: { path: geçilen düğümler (başlangıç hariç, varış dahil), pos, remaining, choices: null | [id] }
    function walk(g, pos, steps) {
        var path = [];
        var remaining = steps;
        while (remaining > 0) {
            var next = g.byId[pos].next;
            if (next.length === 0) break;
            if (next.length > 1) return { path: path, pos: pos, remaining: remaining, choices: next.slice() };
            pos = next[0];
            path.push(pos);
            remaining--;
        }
        return { path: path, pos: pos, remaining: remaining, choices: null };
    }

    // Dallanmada seçilen yöne ilk adımı atıp yürümeye devam eder.
    function walkVia(g, pos, steps, to) {
        var node = g.byId[pos];
        if (!node || node.next.indexOf(to) < 0 || steps < 1) return null;
        var rest = walk(g, to, steps - 1);
        return { path: [to].concat(rest.path), pos: rest.pos, remaining: rest.remaining, choices: rest.choices };
    }

    // Haritayı doğrular; hata mesajları dizisi döner (boş = geçerli).
    function validate(map) {
        var errors = [];
        var g = index(map);
        var ids = map.nodes.map(function (n) { return n.id; });
        if (map.nodes.length < 35 || map.nodes.length > 50) errors.push('düğüm sayısı 35-50 olmalı: ' + map.nodes.length);
        if (new Set(ids).size !== ids.length) errors.push('yinelenen düğüm kimliği');
        map.nodes.forEach(function (n) {
            if (TYPES.indexOf(n.type) < 0) errors.push('geçersiz tür ' + n.id);
            if (!(n.x >= 0 && n.x <= 1000 && n.y >= 0 && n.y <= 700)) errors.push('sınır dışı ' + n.id);
            if (!n.next.length) errors.push('çıkışsız düğüm ' + n.id);
            n.next.forEach(function (to) { if (!g.byId[to]) errors.push('bilinmeyen hedef ' + n.id + '->' + to); });
        });
        if (g.starts.length < 8) errors.push('en az 8 başlangıç düğümü gerekir: ' + g.starts.length);
        var branching = map.nodes.filter(function (n) { return n.next.length > 1; }).length;
        if (branching < 2) errors.push('en az 2 dallanma gerekir: ' + branching);
        ['treasure', 'weapon', 'event'].forEach(function (t) {
            if (!map.nodes.some(function (n) { return n.type === t; })) errors.push('tür yok: ' + t);
        });
        // her düğümden, başlangıç dışı düğümlerin tamamına yönlü yol var (döngü: hiçbir yerde sıkışma yok)
        var nonStart = map.nodes.filter(function (n) { return n.type !== 'start'; }).map(function (n) { return n.id; });
        function reach(from) {
            var seen = {};
            seen[from] = true;
            var st = [from];
            while (st.length) {
                var c = st.pop();
                g.byId[c].next.forEach(function (to) { if (g.byId[to] && !seen[to]) { seen[to] = true; st.push(to); } });
            }
            return seen;
        }
        nonStart.forEach(function (id) {
            var seen = reach(id);
            nonStart.forEach(function (o) { if (!seen[o]) errors.push('döngüsel değil: ' + id + ' -> ' + o); });
        });
        g.starts.forEach(function (s) {
            var seen = reach(s);
            nonStart.forEach(function (o) { if (!seen[o]) errors.push('başlangıçtan ulaşılamaz: ' + s + ' -> ' + o); });
        });
        for (var i = 0; i < map.nodes.length; i++) {
            for (var j = 0; j < i; j++) {
                var a = map.nodes[i];
                var b = map.nodes[j];
                if (Math.hypot(a.x - b.x, a.y - b.y) < 36) errors.push('düğümler çakışıyor: ' + a.id + ',' + b.id);
            }
        }
        return errors;
    }

    return { TYPES: TYPES, index: index, distances: distances, distance: distance, walk: walk, walkVia: walkVia, validate: validate };
});
