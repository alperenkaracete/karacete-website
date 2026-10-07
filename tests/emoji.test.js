// Canvas emoji çizimi: iPhone Safari degrade fillStyle'ı emojiye boyar ("kahverengi leke"); Emoji.draw her zaman düz renk kullanır.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Emoji = require('../core/emoji.js');

// Durum yığınlı sahte 2D bağlam: fillText anındaki fillStyle/font/alpha kaydedilir
function fakeCtx() {
    const stack = [];
    const c = {
        fillStyle: '#123456', font: '10px x', textAlign: 'left', textBaseline: 'top', globalAlpha: 1, texts: [],
        save() { stack.push({ fillStyle: c.fillStyle, font: c.font, textAlign: c.textAlign, textBaseline: c.textBaseline, globalAlpha: c.globalAlpha }); },
        restore() { Object.assign(c, stack.pop()); },
        fillText(text, x, y) { c.texts.push({ text, x, y, fillStyle: c.fillStyle, font: c.font, align: c.textAlign, baseline: c.textBaseline, alpha: c.globalAlpha }); }
    };
    c.depth = () => stack.length;
    return c;
}

test('Emoji.draw: önceki degrade fillStyle sızmaz, fillText anında düz renk; bağlam geri yüklenir', () => {
    const c = fakeCtx();
    const gradient = { addColorStop() {}, isGradient: true };    // toprak degradesi gibi nesne fillStyle
    c.fillStyle = gradient;
    Emoji.draw(c, '🐶', 100, 200, 36);
    assert.equal(c.texts.length, 1);
    const t = c.texts[0];
    assert.equal(typeof t.fillStyle, 'string', 'degrade değil, düz renk');
    assert.equal(t.text, '🐶'); assert.equal(t.x, 100); assert.equal(t.y, 200);
    assert.ok(t.font.startsWith('36px '));
    assert.ok(t.font.indexOf('Apple Color Emoji') < t.font.indexOf('Segoe UI Emoji'), 'Apple yazı tipi önce');
    assert.equal(t.align, 'center'); assert.equal(t.baseline, 'alphabetic'); assert.equal(t.alpha, 1);
    assert.equal(c.fillStyle, gradient, 'çağıranın fillStyle\'ı geri yüklendi');
    assert.equal(c.font, '10px x'); assert.equal(c.depth(), 0, 'save/restore dengeli');
});

test('Emoji.draw: seçenekler (hizalama, taban çizgisi, saydamlık) yalnız o çizimde geçerli', () => {
    const c = fakeCtx();
    Emoji.draw(c, '🐟', 0, 0, 24, { baseline: 'middle', alpha: 0.35, align: 'left' });
    const t = c.texts[0];
    assert.equal(t.baseline, 'middle'); assert.equal(t.alpha, 0.35); assert.equal(t.align, 'left');
    assert.equal(c.globalAlpha, 1, 'saydamlık sızmadı'); assert.equal(c.textBaseline, 'top');
    assert.equal(Emoji.font(20), '20px ' + Emoji.STACK);
});

test('catdog.js karakter/mermi emojisini doğrudan fillText ile çizmez; emoji.js betiği oyundan önce yüklenir', () => {
    const root = path.join(__dirname, '..');
    const src = fs.readFileSync(path.join(root, 'games', 'catdog.js'), 'utf8');
    assert.ok(!/fillText\(ch\.(emoji|ammo)/.test(src), 'degrade sızıntısına açık doğrudan çizim yok');
    assert.ok((src.match(/Emoji\.draw\(/g) || []).length >= 2, 'karakter + mermi');
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.ok(html.indexOf('core/emoji.js') > 0 && html.indexOf('core/emoji.js') < html.indexOf('games/catdog.js'));
});
