// Parti: nişan (aim) arayüzü — DOM çubuğu (emoji DOM metni: canvas'taki degrade/emoji sorunu yok). Kalıcı bir düğümde yaşar, render() döngüsüne bağlı
// değildir (overlay her render'da silinir; bu düğüm silinmez). Gösterge AĞDA GELMEZ: herkes aim.js indicatorAt(spec, now - startAt) ile kendi çizer.
//
//   create(doc, deps, win?) -> ctl   deps: { act(q), nameOf(id), avatarOf(id) }   (ctl.el kalıcı düğüm)
//   ctl.sync(view, nowMs)            her karede: view.aim varsa canlı çubuk (atan: etkileşimli; diğerleri: salt okunur), yoksa sonuç etiketi ya da gizli
//   ctl.result(ev, nowMs)            'aimres' olayı: gösterge donar, sonuç etiketi AIM_RESULT_MS görünür (yumruk 'garanti': kısa 👊 şovu, çubuk yok)
//   ctl.tap(nowMs)                   atan için tek dokunuş = bırak (pointerdown / Boşluk); basılı tutma yok
//   ctl.destroy()
//   invList(C, p) / chipLabel(C, id, n)  envanter rozetleri (ui.js kullanır; ?kit=1 gibi çoklu sayılarda da tutarlı)
// Yumruk şovu UI'ı/zar düğmesini ENGELLEMEZ: çözüm anlık, aşama yok, şov bileşeni pointer-events: none.
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./aim.js'), require('./config.js'));
    else root.PartiAimUi = factory(root.PartiAim, root.PartiConfig);
})(typeof self !== 'undefined' ? self : this, function (Aim, C) {
    'use strict';

    var TIER_TEXT = { merkez: '🎯 Tam isabet!', bolge: 'İsabet', kenar: 'Kıl payı', iska: 'Iska!', garanti: '👊' };

    function resultText(ev) {
        var base = TIER_TEXT[ev.tier] || ev.tier;
        if (ev.tier === 'iska') return base;
        return base + ' −' + ev.dmg;
    }

    // ---- envanter rozetleri ----
    function invList(Cfg, p) {
        return Cfg.WEAPON_IDS.filter(function (w) { return p.w && p.w[w] > 0; }).map(function (w) { return [w, p.w[w]]; });
    }
    function chipLabel(Cfg, id, n) { return Cfg.WEAPONS[id].emoji + (n > 1 ? ' ×' + n : ''); }

    function create(doc, deps, win) {
        var wnd = win || (typeof window !== 'undefined' ? window : null);
        function el(tag, cls, text) {
            var e = doc.createElement(tag);
            if (cls) e.className = cls;
            if (text !== undefined) e.textContent = text;
            return e;
        }
        var host = el('div', 'pt-aim hidden');
        var title = el('div', 'pt-aim-title', '');
        var row = el('div', 'pt-aim-row');
        var att = el('span', 'pt-aim-att', '🏹');
        var track = el('div', 'pt-aim-track');
        var zone = el('div', 'pt-aim-zone');
        var b3 = el('div', 'pt-aim-b3');
        var b2 = el('div', 'pt-aim-b2');
        var b1 = el('div', 'pt-aim-b1');
        var tgt = el('span', 'pt-aim-tgt', '🎯');
        var ind = el('div', 'pt-aim-ind');
        var drop = el('div', 'pt-aim-drop', 'BIRAK');
        var label = el('div', 'pt-aim-res', '');
        b3.appendChild(b2); b2.appendChild(b1); zone.appendChild(b3); zone.appendChild(tgt);
        track.appendChild(zone); track.appendChild(ind);
        row.appendChild(att); row.appendChild(track);
        host.appendChild(title); host.appendChild(row); host.appendChild(drop); host.appendChild(label);

        var cur = null;               // canlı nişan: { seed, w, d, spec }
        var mineLive = false;         // atan, henüz bırakmadı, süre dolmadı
        var tapped = null;            // bırakılan q [0,1] (yerel: gösterge donar; sonuç gelene dek)
        var tappedSeed = null;
        var res = null;               // { ev, until, kind, spec }
        var lastView = null;
        var lastNow = 0;
        var done = false;

        function setZone(spec) {
            zone.style.left = ((spec.c - spec.half) * 100) + '%';
            zone.style.width = (spec.half * 2 * 100) + '%';
            var t = spec.tiers;
            // iç içe bantlar: kenar (tam), bölge (r2/r3), merkez (r1/r3) — zone genişliğinin oranları
            b3.style.width = '100%';
            b2.style.width = (t[1].r / t[2].r * 100) + '%';
            b1.style.width = (t[0].r / t[1].r * 100) + '%';
        }

        function setInd(p) { ind.style.left = (Math.max(0, Math.min(1, p)) * 100) + '%'; }

        function show(on) { host.className = 'pt-aim' + (on ? '' : ' hidden') + (on && mineLive ? ' pt-aim-mine' : '') + (on && res && res.kind === 'show' ? ' pt-aim-show' : ''); }

        function sync(view, now) {
            if (done) return;
            lastView = view;
            lastNow = now;
            var a = view && view.aim;
            if (a) {
                if (!cur || cur.seed !== a.seed || cur.w !== a.w || cur.d !== a.d) {
                    cur = { seed: a.seed, w: a.w, d: a.d, spec: Aim.makeAim(a.w, a.seed, a.d) };
                    if (tappedSeed !== a.seed) { tapped = null; tappedSeed = null; }
                    res = null;
                }
                if (!cur.spec) { show(false); return; }
                var spec = cur.spec;
                var elapsed = Math.max(0, now - a.startAt);
                var isMine = view.me && a.by === view.me.id;
                mineLive = !!isMine && tapped === null && elapsed < a.maxMs && view.mode !== 'spectator';
                setZone(spec);
                tgt.textContent = deps.avatarOf(a.target) || '🎯';
                att.textContent = deps.avatarOf(a.by) || '🏹';
                var pos = tapped !== null ? tapped : Aim.indicatorAt(spec, Math.min(elapsed, a.maxMs));
                setInd(pos);
                track.className = 'pt-aim-track' + (elapsed < C.AIM_MIN_MS ? ' pt-aim-wait' : '');         // ilk AIM_MIN_MS: çubuk soluk ("hazırlanıyor")
                title.textContent = isMine ? '🏹 ' + deps.nameOf(a.target) + ' — hedefte BIRAK!' : '🏹 ' + deps.nameOf(a.by) + ' → ' + deps.nameOf(a.target) + ' nişan alıyor';
                drop.textContent = !isMine ? '' : (tapped !== null ? 'Bıraktın…' : (elapsed >= a.maxMs ? 'Süre doldu' : 'BIRAK'));
                label.textContent = '';
                row.style.display = '';
                show(true);
                return;
            }
            // canlı nişan yok: sonuç etiketi (donmuş gösterge) ya da gizli
            mineLive = false;
            if (res && now < res.until) {
                if (res.kind === 'bar' && res.spec) {
                    setZone(res.spec);
                    setInd(res.ev.q >= 0 ? res.ev.q / 1000 : (tapped !== null ? tapped : 0));
                    row.style.display = '';
                    title.textContent = '🏹 ' + deps.nameOf(res.ev.id) + ' → ' + deps.nameOf(res.ev.target);
                } else {
                    row.style.display = 'none';
                    title.textContent = deps.nameOf(res.ev.id) + ' → ' + deps.nameOf(res.ev.target);
                }
                drop.textContent = '';
                label.textContent = resultText(res.ev);
                show(true);
                return;
            }
            res = null;
            cur = null;
            tapped = null;
            tappedSeed = null;
            show(false);
        }

        function result(ev, now) {
            if (done) return;
            var skill = C.WEAPONS[ev.w] && C.WEAPONS[ev.w].skill;
            if (ev.tier === 'garanti') {
                res = { ev: ev, until: now + (skill && skill.ms ? skill.ms : 900), kind: 'show', spec: null };
            } else {
                res = { ev: ev, until: now + C.AIM_RESULT_MS, kind: 'bar', spec: cur ? cur.spec : null };
            }
        }

        function tap(now) {
            if (done || !mineLive || !cur || !lastView || !lastView.aim) return false;
            var elapsed = now - lastView.aim.startAt;
            if (elapsed < C.AIM_MIN_MS || elapsed >= lastView.aim.maxMs) return false;       // çubuk görünür olduktan ilk AIM_MIN_MS'te dokunuş/Boşluk YOK SAYILIR (gösterge donmaz, mesaj gitmez)
            var p = Aim.indicatorAt(cur.spec, elapsed);
            var q = Math.max(0, Math.min(1000, Math.round(p * 1000)));
            tapped = q / 1000;                    // gösterge hemen donar
            tappedSeed = cur.seed;
            mineLive = false;
            drop.textContent = 'Bıraktın…';
            show(true);
            deps.act(q);
            return true;
        }

        // tek dokunuş = bırak: çubuğun tamamı + BIRAK alanı (basılı tutma yok; pointerdown tek tetikler)
        var nowFn = deps.now || Date.now;
        var onDown = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); tap(nowFn()); };
        track.addEventListener('pointerdown', onDown);
        drop.addEventListener('pointerdown', onDown);
        host.addEventListener('pointerdown', onDown);
        var onKey = function (ev) {
            if (ev.key !== ' ' && ev.key !== 'Spacebar') return;
            if (!mineLive) return;
            if (ev.preventDefault) ev.preventDefault();
            if (ev.repeat) return;
            tap(nowFn());
        };
        if (doc.addEventListener) doc.addEventListener('keydown', onKey);

        function destroy() {
            if (done) return;
            done = true;
            track.removeEventListener('pointerdown', onDown);
            drop.removeEventListener('pointerdown', onDown);
            host.removeEventListener('pointerdown', onDown);
            if (doc.removeEventListener) doc.removeEventListener('keydown', onKey);
            host.textContent = '';
        }

        void wnd;
        return { el: host, sync: sync, result: result, tap: tap, destroy: destroy, _state: function () { return { mineLive: mineLive, tapped: tapped, res: res }; } };
    }

    return { create: create, resultText: resultText, invList: invList, chipLabel: chipLabel, TIER_TEXT: TIER_TEXT };
});
