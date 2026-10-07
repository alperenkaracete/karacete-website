// Düello testleri için ortak sahte parçalar: sahte DOM, gerçek Duel'i saran oyun tanımı, elle ilerletilen saat.
const Duel = require('../core/duel.js');

function fakeNode(doc) {
    const node = {
        ownerDocument: doc, children: [], className: '', _text: '',
        classList: { set: new Set(), add(c) { this.set.add(c); } },
        appendChild(c) { node.children.push(c); return c; },
        get textContent() { return node._text + node.children.map((c) => c.textContent).join(''); },
        set textContent(v) { node._text = v; node.children = []; }
    };
    return node;
}
function fakeRoot() {
    const doc = { createElement: () => fakeNode(doc) };
    return fakeNode(doc);
}

function makeDefs(prefix, rules, log) {
    const def = {
        duel: null, inits: 0, destroys: 0,
        init(ctx) { def.inits++; def.ctx = ctx; def.duel = Duel.create({ prefix, rules, ctx, random: () => 0.1, onChange: (v) => { def.view = v; } }); def.duel.start(); },
        onMessage(m) { if (log) log.push(m); def.duel.onMessage(m); },
        destroy() { def.destroys++; def.duel = null; }
    };
    return def;
}

function clock() {
    let t = 0;
    const timeouts = [];
    const intervals = [];
    return {
        now: () => t,
        timers: {
            set(f, ms) { const o = { f, at: t + ms }; timeouts.push(o); return o; },
            clear(o) { const i = timeouts.indexOf(o); if (i >= 0) timeouts.splice(i, 1); },
            every(f) { const o = { f }; intervals.push(o); return o; },
            stop(o) { const i = intervals.indexOf(o); if (i >= 0) intervals.splice(i, 1); }
        },
        advance(ms) {
            t += ms;
            timeouts.filter((o) => o.at <= t).forEach((o) => { timeouts.splice(timeouts.indexOf(o), 1); o.f(); });
            intervals.slice().forEach((o) => o.f());
        },
        pending: () => timeouts.length
    };
}

module.exports = { fakeRoot, makeDefs, clock };
