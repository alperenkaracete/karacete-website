// Canvas'ta renkli emoji çizimi (DOM'suz; yalnızca verilen 2D bağlama dokunur, Node'da sahte bağlamla test edilir).
//
// Neden: WebKit (iPhone Safari), `fillStyle` bir degrade/desen iken renkli emojiyi O degradeyle boyanmış siluet olarak çizer
// (örn. toprak degradesinden sonra kedi/köpek "kahverengi leke" olur). Chrome/Android etkilenmez. `Emoji.draw` her çizimde
// düz bir `fillStyle` kullanır ve bağlam durumunu `save/restore` ile korur, böylece önceki degrade sızmaz.
//
//   Emoji.draw(c, text, x, y, size, { align?, baseline?, alpha? })
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.Emoji = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    var STACK = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

    function font(size) { return size + 'px ' + STACK; }

    function draw(c, text, x, y, size, opts) {
        opts = opts || {};
        c.save();
        c.fillStyle = '#000';                       // düz renk: emoji bitmap'i etkilenmez, degrade sızmaz
        c.font = font(size);
        c.textAlign = opts.align || 'center';
        c.textBaseline = opts.baseline || 'alphabetic';
        if (opts.alpha !== undefined) c.globalAlpha = opts.alpha;
        c.fillText(text, x, y);
        c.restore();
    }

    return { draw: draw, font: font, STACK: STACK };
});
