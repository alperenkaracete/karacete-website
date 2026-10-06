// Kafa Topu: gerçek zamanlı, iki kişilik yandan görünüşlü futbol (arayüz katmanı).
// Fizik ve kurallar games/kafatopu-rules.js, ağ/maç akışı games/kafatopu-net.js içindedir;
// bu dosya yüz seçimi (emoji / fotoğraf / kamera), canvas çizimi ve girdiyi (klavye + çoklu dokunma) bağlar.
// Çizimler tamamen canvas/CSS ile yapılır; harici görsel ya da ses kullanılmaz.
//
// Gizlilik: fotoğraf yalnızca bellekte tutulur, küçültülüp rakibe gönderilir; repoya/sunucuya kaydedilmez.
// Gelen yüz verisi doğrulanmadan kullanılmaz ve HTML'e asla yazılmaz (yalnızca Image + canvas).
(function () {
    var K = KafaTopuRules;

    var EMOJIS = ['😀', '😎', '🤩', '😍', '🥳', '🤓', '😜', '🤪', '🤠', '😇', '🤖', '👻',
        '👽', '🐱', '🐶', '🐼', '🦊', '🐸', '🐵', '🦁', '🐯', '🐷', '🐰', '🤡'];
    var FALLBACK_FACE = '🙂';
    var TEAM_COLORS = ['#2f80ed', '#e5484d'];          // sol, sağ
    var EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
    var PHOTO_SIZES = [[64, 0.7], [56, 0.6], [48, 0.5], [40, 0.4]];   // [kenar px, JPEG kalitesi]
    var MAX_FACE_IMAGE_PX = 128;
    var QUERY = (typeof location !== 'undefined' && location.search) || '';
    var DEBUG = /[?&]debug=1(&|$)/.test(QUERY);
    var NO_PREDICT = DEBUG && /[?&]notahmin=1(&|$)/.test(QUERY);   // A/B karşılaştırması için tahmini kapatır
    var END_OVERLAY_DELAY = 1600;                      // ms: son golün kutlaması görünsün

    var KEYS = {
        ArrowLeft: 'left', KeyA: 'left',
        ArrowRight: 'right', KeyD: 'right',
        ArrowUp: 'jump', KeyW: 'jump',
        Space: 'kick', KeyZ: 'kick'
    };

    // ---- Durum (init'te sıfırlanır) ----
    var root = null;
    var ctx2d = null;
    var els = null;
    var net = null;
    var gameCtx = null;
    var view = null;
    var rafId = null;
    var listeners = [];
    var resizeObserver = null;
    var cameraStream = null;
    var stageScale = { css: 1, dpr: 1 };
    var keyState = { left: false, right: false, jump: false, kick: false };
    var buttonState = { left: false, right: false, jump: false, kick: false };
    var faceImages = {};           // face metni -> { img, ok }
    var myFace = '😀';
    var overlaySignature = '';
    var setupSignature = '';
    var particles = [];
    var banner = null;             // { text, sub, born, dur }
    var endShowAt = 0;
    var ballAngle = 0;
    var lastBallX = null;
    var lastDrawT = 0;
    var crowd = null;

    function listen(target, type, handler, opts) {
        target.addEventListener(type, handler, opts);
        listeners.push(function () { target.removeEventListener(type, handler, opts); });
    }

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function nowMs() { return performance.now(); }

    // ---------- Yüz görselleri ----------
    function faceImageFor(face) {
        var entry = faceImages[face];
        if (entry) return entry;
        entry = { img: null, ok: false };
        faceImages[face] = entry;
        if (K.isJpegFace(face)) {
            var img = new Image();
            img.onload = function () {
                // beklenmedik boyutlu görselleri kullanma (yalnızca küçük yuvarlak yüzler)
                if (img.naturalWidth > 0 && img.naturalHeight > 0 &&
                    img.naturalWidth <= MAX_FACE_IMAGE_PX && img.naturalHeight <= MAX_FACE_IMAGE_PX) entry.ok = true;
                if (els) drawPreview();          // yüz seçimi önizlemesi yüklenince tazelensin
            };
            img.src = face;
            entry.img = img;
        }
        return entry;
    }

    function drawFace(c, face, x, y, r, ringColor) {
        c.save();
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.closePath();
        var skin = c.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
        skin.addColorStop(0, '#fff6d6');
        skin.addColorStop(1, '#f5c76a');
        c.fillStyle = skin;
        c.fill();
        c.clip();
        var entry = K.isJpegFace(face) ? faceImageFor(face) : null;
        if (entry && entry.ok) {
            c.drawImage(entry.img, x - r, y - r, r * 2, r * 2);
        } else {
            var emoji = K.isEmojiFace(face) ? face : FALLBACK_FACE;
            c.font = Math.round(r * 1.45) + 'px ' + EMOJI_FONT;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillStyle = '#000';
            c.fillText(emoji, x, y + r * 0.08);
        }
        c.restore();
        if (ringColor) {
            c.beginPath();
            c.arc(x, y, r, 0, Math.PI * 2);
            c.lineWidth = Math.max(2, r * 0.14);
            c.strokeStyle = ringColor;
            c.stroke();
        }
    }

    // Fotoğraf / kamera karesini ortadan kareye kırpıp küçültür, yuvarlak maskeler, JPEG data URL döndürür.
    // Boyut sınırına sığmazsa daha küçük/düşük kaliteyle dener; hiçbiri sığmazsa null.
    function makeFaceFromSource(source, sw, sh) {
        var side = Math.min(sw, sh);
        var sx = (sw - side) / 2;
        var sy = (sh - side) / 2;
        for (var i = 0; i < PHOTO_SIZES.length; i++) {
            var size = PHOTO_SIZES[i][0];
            var quality = PHOTO_SIZES[i][1];
            var canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            var c = canvas.getContext('2d');
            c.fillStyle = '#ffffff';                    // JPEG saydamlığı desteklemez
            c.fillRect(0, 0, size, size);
            c.beginPath();
            c.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
            c.closePath();
            c.clip();
            c.drawImage(source, sx, sy, side, side, 0, 0, size, size);
            var url = canvas.toDataURL('image/jpeg', quality);
            if (K.validateFace(url) !== null) return url;
        }
        return null;
    }

    function loadImageFile(file) {
        if (typeof createImageBitmap === 'function') {
            return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
                return createImageBitmap(file);
            }).then(function (bmp) {
                return { source: bmp, w: bmp.width, h: bmp.height, done: function () { if (bmp.close) bmp.close(); } };
            });
        }
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                resolve({ source: img, w: img.naturalWidth, h: img.naturalHeight, done: function () { URL.revokeObjectURL(url); } });
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('görsel okunamadı')); };
            img.src = url;
        });
    }

    // ---------- Yüz seçimi ekranı ----------
    function setFaceChoice(face) {
        myFace = face;
        net.setFace(face);
        drawPreview();
        Array.prototype.forEach.call(els.emojiGrid.children, function (btn) {
            btn.classList.toggle('selected', btn.dataset.face === face);
        });
    }

    function setFaceMessage(text, isError) {
        els.faceMsg.textContent = text || '';
        els.faceMsg.classList.toggle('error', !!isError);
    }

    function drawPreview() {
        var c = els.preview.getContext('2d');
        c.clearRect(0, 0, els.preview.width, els.preview.height);
        drawFace(c, myFace, els.preview.width / 2, els.preview.height / 2, els.preview.width / 2 - 6, '#2f80ed');
    }

    function usePhotoFromSource(source, w, h, doneFn) {
        var url = null;
        try { url = makeFaceFromSource(source, w, h); } catch (e) { url = null; }
        if (doneFn) doneFn();
        if (url === null) {
            setFaceMessage('Fotoğraf çok büyük olduğu için kullanılamadı, emoji seç ya da başka bir fotoğraf dene.', true);
            return false;
        }
        faceImageFor(url);
        setFaceChoice(url);
        Array.prototype.forEach.call(els.emojiGrid.children, function (b) { b.classList.remove('selected'); });
        setFaceMessage('Fotoğraf hazır (' + Math.round(url.length / 1024 * 10) / 10 + ' KB). Sadece rakibine gösterilir, kaydedilmez.');
        return true;
    }

    function onFilePicked() {
        var file = els.file.files && els.file.files[0];
        els.file.value = '';                            // aynı dosya tekrar seçilebilsin
        if (!file) return;
        if (!/^image\//.test(file.type)) {
            setFaceMessage('Lütfen bir görsel dosyası seç.', true);
            return;
        }
        setFaceMessage('Fotoğraf işleniyor…');
        loadImageFile(file).then(function (loaded) {
            usePhotoFromSource(loaded.source, loaded.w, loaded.h, loaded.done);
        }).catch(function () {
            setFaceMessage('Fotoğraf okunamadı. Emoji seçebilir ya da başka bir fotoğraf deneyebilirsin.', true);
        });
    }

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(function (t) { t.stop(); });
            cameraStream = null;
        }
        if (els && els.video) els.video.srcObject = null;
        if (els && els.camera) els.camera.classList.remove('show');
    }

    function openCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setFaceMessage('Kamera bu tarayıcıda ya da bağlantıda kullanılamıyor. Emoji seç ya da fotoğraf yükle.', true);
            return;
        }
        setFaceMessage('Kamera izni bekleniyor…');
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } }, audio: false })
            .then(function (stream) {
                if (!els) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }   // bu arada oyundan çıkıldı
                cameraStream = stream;
                els.video.srcObject = stream;
                els.camera.classList.add('show');
                var p = els.video.play();
                if (p && p.catch) p.catch(function () { /* otomatik oynatma engeli: kullanıcı zaten etkileşimde */ });
                setFaceMessage('');
            })
            .catch(function (err) {
                var denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
                setFaceMessage(denied
                    ? 'Kamera izni verilmedi. Emoji seçebilir ya da fotoğraf yükleyebilirsin.'
                    : 'Kamera açılamadı. Emoji seçebilir ya da fotoğraf yükleyebilirsin.', true);
            });
    }

    function captureFromCamera() {
        var v = els.video;
        if (!v.videoWidth || !v.videoHeight) {
            setFaceMessage('Kamera henüz hazır değil, bir saniye bekle.', true);
            return;
        }
        var ok = usePhotoFromSource(v, v.videoWidth, v.videoHeight, null);
        if (ok) stopCamera();
    }

    // ---------- Arayüz kurulumu ----------
    function buildDom() {
        var rootEl = el('div', 'kt-root');

        // yüz seçimi
        var setup = el('div', 'kt-setup');
        var panel = el('div', 'kt-setup-panel');
        panel.appendChild(el('h2', 'kt-title', '⚽ Kafa Topu'));
        var cols = el('div', 'kt-setup-cols');

        var left = el('div', 'kt-setup-left');
        var preview = document.createElement('canvas');
        preview.className = 'kt-preview';
        preview.width = 120;
        preview.height = 120;
        var btnCamera = el('button', 'kt-btn', '📷 Kamera ile çek');
        btnCamera.type = 'button';
        var btnUpload = el('button', 'kt-btn', '🖼️ Fotoğraf yükle');
        btnUpload.type = 'button';
        var file = document.createElement('input');
        file.type = 'file';
        file.accept = 'image/*';
        file.className = 'kt-file';
        left.append(preview, btnCamera, btnUpload, file);

        var right = el('div', 'kt-setup-right');
        right.appendChild(el('p', 'kt-hint', 'Ya da bir emoji seç:'));
        var grid = el('div', 'kt-emoji-grid');
        EMOJIS.forEach(function (emoji) {
            var b = el('button', 'kt-emoji', emoji);
            b.type = 'button';
            b.dataset.face = emoji;
            b.setAttribute('aria-label', 'Emoji ' + emoji);
            grid.appendChild(b);
        });
        right.appendChild(grid);
        cols.append(left, right);

        var privacy = el('p', 'kt-privacy', '🔒 Fotoğrafın sadece rakibine gösterilir, kaydedilmez.');
        var msg = el('p', 'kt-face-msg');
        msg.setAttribute('role', 'status');
        var readyBtn = el('button', 'kt-btn primary kt-ready', 'Hazırım');
        readyBtn.type = 'button';
        panel.append(cols, privacy, msg, readyBtn);

        var camera = el('div', 'kt-camera');
        var video = document.createElement('video');
        video.className = 'kt-video';
        video.setAttribute('playsinline', '');
        video.muted = true;
        var camActions = el('div', 'kt-camera-actions');
        var snap = el('button', 'kt-btn primary', 'Çek');
        snap.type = 'button';
        var cancel = el('button', 'kt-btn', 'Vazgeç');
        cancel.type = 'button';
        camActions.append(snap, cancel);
        camera.append(video, camActions);
        setup.append(panel, camera);

        // sahne
        var stage = el('div', 'kt-stage');
        var wrap = el('div', 'kt-canvas-wrap');
        var canvas = document.createElement('canvas');
        canvas.className = 'kt-canvas';
        var controls = el('div', 'kt-controls');
        var buttons = {};
        [['left', '◀', 'kt-ctl-left'], ['right', '▶', 'kt-ctl-right'], ['jump', '⤒', 'kt-ctl-jump'], ['kick', '⚽', 'kt-ctl-kick']].forEach(function (def) {
            var b = el('button', 'kt-ctl ' + def[2], def[1]);
            b.type = 'button';
            b.setAttribute('aria-label', { left: 'Sola', right: 'Sağa', jump: 'Zıpla', kick: 'Vur' }[def[0]]);
            buttons[def[0]] = b;
            controls.appendChild(b);
        });
        var overlay = el('div', 'kt-overlay');
        var toast = el('div', 'kt-toast');
        wrap.append(canvas, controls, overlay, toast);
        stage.appendChild(wrap);

        var rotate = el('div', 'kt-rotate');
        rotate.append(el('div', 'kt-rotate-icon', '📱'), el('p', '', 'Telefonu yatay çevir'));

        rootEl.append(setup, stage, rotate);
        gameCtx.root.appendChild(rootEl);

        return {
            rootEl: rootEl, setup: setup, stage: stage, wrap: wrap, canvas: canvas, overlay: overlay, toast: toast,
            preview: preview, file: file, btnCamera: btnCamera, btnUpload: btnUpload, emojiGrid: grid, faceMsg: msg,
            readyBtn: readyBtn, camera: camera, video: video, snap: snap, cancel: cancel, buttons: buttons
        };
    }

    // ---------- Girdi ----------
    function pushInput() {
        net.setInput({
            left: keyState.left || buttonState.left,
            right: keyState.right || buttonState.right,
            jump: keyState.jump || buttonState.jump,
            kick: keyState.kick || buttonState.kick
        });
    }

    function releaseEverything() {
        keyState = { left: false, right: false, jump: false, kick: false };
        buttonState = { left: false, right: false, jump: false, kick: false };
        Object.keys(els.buttons).forEach(function (k) { els.buttons[k].classList.remove('down'); });
        net.releaseAll();
    }

    function inStage() {
        return view && view.mode !== 'setup';
    }

    function onKeyDown(e) {
        var action = KEYS[e.code];
        if (!action || !inStage()) return;
        e.preventDefault();
        if (e.repeat) return;
        keyState[action] = true;
        pushInput();
    }

    function onKeyUp(e) {
        var action = KEYS[e.code];
        if (!action || !inStage()) return;
        e.preventDefault();
        keyState[action] = false;
        pushInput();
    }

    function bindButton(action, button) {
        var active = {};    // pointerId -> true (aynı butonda birden çok parmak)
        function down(e) {
            e.preventDefault();
            try { button.setPointerCapture(e.pointerId); } catch (err) { /* yoksay */ }
            active[e.pointerId] = true;
            buttonState[action] = true;
            button.classList.add('down');
            pushInput();
        }
        function up(e) {
            delete active[e.pointerId];
            if (Object.keys(active).length === 0) {
                buttonState[action] = false;
                button.classList.remove('down');
                pushInput();
            }
        }
        listen(button, 'pointerdown', down);
        listen(button, 'pointerup', up);
        listen(button, 'pointercancel', up);
        listen(button, 'lostpointercapture', up);
        listen(button, 'contextmenu', function (e) { e.preventDefault(); });
    }

    // ---------- Boyutlandırma ----------
    function resize() {
        if (!els) return;
        var rect = els.stage.getBoundingClientRect();
        var availW = Math.max(100, rect.width);
        var availH = Math.max(60, rect.height);
        var scale = Math.min(availW / K.W, availH / K.H);
        var cssW = Math.floor(K.W * scale);
        var cssH = Math.floor(K.H * scale);
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        els.wrap.style.width = cssW + 'px';
        els.wrap.style.height = cssH + 'px';
        els.canvas.style.width = cssW + 'px';
        els.canvas.style.height = cssH + 'px';
        els.canvas.width = Math.round(cssW * dpr);
        els.canvas.height = Math.round(cssH * dpr);
        stageScale = { css: cssW / K.W, dpr: dpr, pxScale: (cssW * dpr) / K.W };
        ctx2d.setTransform(stageScale.pxScale, 0, 0, stageScale.pxScale, 0, 0);
        // dokunmatik düğmeler canvas'a göre ölçeklenir
        els.wrap.style.setProperty('--kt-unit', Math.max(44, Math.min(84, cssH * 0.2)) + 'px');
    }

    // ---------- Arka plan (bir kez çizilir) ----------
    function buildCrowd() {
        var c = document.createElement('canvas');
        c.width = K.W;
        c.height = 200;
        var g = c.getContext('2d');
        var seed = 7;
        function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
        var colors = ['#e74c3c', '#f1c40f', '#3498db', '#ecf0f1', '#9b59b6', '#2ecc71', '#e67e22'];
        g.fillStyle = '#2b3a55';
        g.fillRect(0, 0, K.W, 200);
        for (var row = 0; row < 6; row++) {
            for (var x = -10; x < K.W + 10; x += 14) {
                var cx = x + (row % 2) * 7 + rnd() * 3;
                var cy = 20 + row * 28 + rnd() * 4;
                g.fillStyle = colors[Math.floor(rnd() * colors.length)];
                g.beginPath();
                g.arc(cx, cy + 10, 6, 0, Math.PI * 2);      // gövde
                g.fill();
                g.fillStyle = '#f2c9a0';
                g.beginPath();
                g.arc(cx, cy, 4.5, 0, Math.PI * 2);         // kafa
                g.fill();
            }
        }
        // üstten gölge
        var shade = g.createLinearGradient(0, 0, 0, 200);
        shade.addColorStop(0, 'rgba(10,20,40,0.55)');
        shade.addColorStop(1, 'rgba(10,20,40,0)');
        g.fillStyle = shade;
        g.fillRect(0, 0, K.W, 200);
        return c;
    }

    // ---------- Çizim ----------
    function drawBackground(c) {
        var sky = c.createLinearGradient(0, 0, 0, K.GROUND);
        sky.addColorStop(0, '#1f3b73');
        sky.addColorStop(0.55, '#4a78c9');
        sky.addColorStop(1, '#9ccfff');
        c.fillStyle = sky;
        c.fillRect(0, 0, K.W, K.H);
        c.drawImage(crowd, 0, 150);
        // reklam panoları
        c.fillStyle = '#1c2a44';
        c.fillRect(0, 348, K.W, 52);
        var labels = ['KARACETE', '⚽', 'KAFA TOPU', '🏆', 'KARACETE', '⚽', 'KAFA TOPU', '🏆'];
        c.font = 'bold 20px sans-serif';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        for (var i = 0; i < labels.length; i++) {
            c.fillStyle = i % 2 ? '#f1c40f' : '#ecf0f1';
            c.fillText(labels[i], 100 * i + 50, 374);
        }
        // çimen
        for (var x = 0; x < K.W; x += 50) {
            c.fillStyle = (x / 50) % 2 ? '#3da34d' : '#46b457';
            c.fillRect(x, K.GROUND, 50, K.H - K.GROUND);
        }
        var edge = c.createLinearGradient(0, K.GROUND, 0, K.GROUND + 14);
        edge.addColorStop(0, 'rgba(0,0,0,0.25)');
        edge.addColorStop(1, 'rgba(0,0,0,0)');
        c.fillStyle = edge;
        c.fillRect(0, K.GROUND, K.W, 14);
        c.strokeStyle = 'rgba(255,255,255,0.85)';
        c.lineWidth = 3;
        c.beginPath();
        c.moveTo(0, K.GROUND);
        c.lineTo(K.W, K.GROUND);
        c.stroke();
        c.beginPath();                                   // orta çizgi
        c.moveTo(K.W / 2, K.GROUND);
        c.lineTo(K.W / 2, K.H);
        c.stroke();
    }

    function drawGoal(c, left) {
        var x0 = left ? 0 : K.W - K.GOAL_W;
        c.save();
        c.beginPath();
        c.rect(x0, K.CROSSBAR_Y, K.GOAL_W, K.GROUND - K.CROSSBAR_Y);
        c.clip();
        c.fillStyle = 'rgba(255,255,255,0.10)';
        c.fillRect(x0, K.CROSSBAR_Y, K.GOAL_W, K.GROUND - K.CROSSBAR_Y);
        c.strokeStyle = 'rgba(255,255,255,0.45)';
        c.lineWidth = 1;
        c.beginPath();
        for (var gx = 0; gx <= K.GOAL_W; gx += 10) { c.moveTo(x0 + gx, K.CROSSBAR_Y); c.lineTo(x0 + gx, K.GROUND); }
        for (var gy = K.CROSSBAR_Y; gy <= K.GROUND; gy += 10) { c.moveTo(x0, gy); c.lineTo(x0 + K.GOAL_W, gy); }
        c.stroke();
        c.restore();
        // üst çizgi + ön direk
        c.fillStyle = '#f4f4f4';
        c.fillRect(x0, K.CROSSBAR_Y, K.GOAL_W, K.CROSSBAR_T);
        var postX = left ? K.GOAL_W - 4 : K.W - K.GOAL_W;
        c.fillRect(postX, K.CROSSBAR_Y, 4, K.GROUND - K.CROSSBAR_Y);
        c.fillStyle = 'rgba(0,0,0,0.18)';
        c.fillRect(x0, K.CROSSBAR_Y + K.CROSSBAR_T, K.GOAL_W, 4);
    }

    function drawShadow(c, x, groundY, r, height) {
        var k = Math.max(0.35, 1 - height / 260);
        c.fillStyle = 'rgba(0,0,0,' + (0.28 * k) + ')';
        c.beginPath();
        c.ellipse(x, groundY + 4, r * k * 1.1, r * 0.28 * k, 0, 0, Math.PI * 2);
        c.fill();
    }

    function drawBall(c, x, y) {
        var r = K.BALL_R;
        drawShadow(c, x, K.GROUND, r, K.GROUND - y);
        c.save();
        c.translate(x, y);
        c.rotate(ballAngle);
        c.beginPath();
        c.arc(0, 0, r, 0, Math.PI * 2);
        var g = c.createRadialGradient(-r * 0.35, -r * 0.4, 2, 0, 0, r);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#d6d6d6');
        c.fillStyle = g;
        c.fill();
        c.clip();
        c.fillStyle = '#222';
        function pentagon(cx, cy, pr, rot) {
            c.beginPath();
            for (var i = 0; i < 5; i++) {
                var a = rot + i * Math.PI * 2 / 5;
                var px = cx + Math.cos(a) * pr;
                var py = cy + Math.sin(a) * pr;
                if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
            }
            c.closePath();
            c.fill();
        }
        pentagon(0, 0, r * 0.38, -Math.PI / 2);
        for (var i = 0; i < 5; i++) {
            var a = -Math.PI / 2 + i * Math.PI * 2 / 5;
            pentagon(Math.cos(a) * r * 1.05, Math.sin(a) * r * 1.05, r * 0.34, a + Math.PI / 2);
        }
        c.restore();
        c.beginPath();
        c.arc(x, y, r, 0, Math.PI * 2);
        c.lineWidth = 1.5;
        c.strokeStyle = 'rgba(0,0,0,0.55)';
        c.stroke();
    }

    function drawPlayer(c, x, y, kickPct, dir, color, face) {
        drawShadow(c, x, K.GROUND, K.HEAD_R, K.HEAD_STAND_Y - y);
        var foot = K.footPos({ x: x, y: y, dir: dir, kick: kickPct > 0 ? K.KICK_TIME * (1 - kickPct / 100) : 0 });
        // bacak
        c.strokeStyle = color;
        c.lineWidth = 7;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(x, y + K.HEAD_R - 6);
        c.lineTo(foot.x, foot.y - 2);
        c.stroke();
        // bot
        c.fillStyle = '#1b1b1b';
        c.beginPath();
        c.ellipse(foot.x + dir * 4, foot.y + 2, K.FOOT_R + 3, K.FOOT_R - 2, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = '#f4f4f4';
        c.fillRect(foot.x - K.FOOT_R, foot.y + K.FOOT_R - 4, K.FOOT_R * 2 + 6, 3);
        // gövde parçası (forma)
        c.fillStyle = color;
        c.beginPath();
        c.ellipse(x, y + K.HEAD_R + 2, 16, 11, 0, 0, Math.PI * 2);
        c.fill();
        // yüz
        drawFace(c, face, x, y, K.HEAD_R, color);
    }

    function playerName(v, idx) {
        if (idx === v.me.index) return v.me.name;
        return v.opponent ? v.opponent.name : '…';
    }

    function playerFace(v, idx) {
        if (idx === v.me.index) return v.me.face || myFace;
        return v.opponent && v.opponent.face ? v.opponent.face : FALLBACK_FACE;
    }

    function formatTime(sec) {
        var s = Math.max(0, Math.ceil(sec));
        return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60);
    }

    function drawHud(c, v, frame) {
        var leftIdx = K.leftIndex(v.swap);
        var rightIdx = 1 - leftIdx;
        // orta pano
        c.fillStyle = 'rgba(10,20,40,0.72)';
        var bx = K.W / 2 - 110;
        c.beginPath();
        c.roundRect ? c.roundRect(bx, 6, 220, 46, 12) : c.rect(bx, 6, 220, 46);
        c.fill();
        c.fillStyle = '#fff';
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = 'bold 30px sans-serif';
        c.fillText(frame.sc[leftIdx] + ' : ' + frame.sc[rightIdx], K.W / 2, 25);
        c.font = '14px sans-serif';
        c.fillStyle = frame.g ? '#ffd400' : 'rgba(255,255,255,0.85)';
        c.fillText(frame.g ? 'ALTIN GOL' : formatTime(frame.tm), K.W / 2, 45);
        // isimler + küçük yüzler
        [[leftIdx, 14, 'left'], [rightIdx, K.W - 14, 'right']].forEach(function (d, i) {
            var idx = d[0];
            var x = d[1];
            c.fillStyle = 'rgba(10,20,40,0.72)';
            var w = 150;
            var x0 = i === 0 ? x : x - w;
            c.beginPath();
            c.roundRect ? c.roundRect(x0, 8, w, 38, 12) : c.rect(x0, 8, w, 38);
            c.fill();
            var fx = i === 0 ? x0 + 20 : x0 + w - 20;
            drawFace(c, playerFace(v, idx), fx, 27, 15, TEAM_COLORS[i]);
            c.fillStyle = '#fff';
            c.font = 'bold 15px sans-serif';
            c.textAlign = i === 0 ? 'left' : 'right';
            c.textBaseline = 'middle';
            var label = playerName(v, idx);
            if (label.length > 11) label = label.slice(0, 10) + '…';
            c.fillText(label, i === 0 ? x0 + 42 : x0 + w - 42, 27);
        });
        drawNetInfo(c, v);
    }

    // Köşede küçük ping göstergesi; ?debug=1 ile ağ ölçümleri (anlık görüntü hızı, gecikme, tahmin hatası).
    function drawNetInfo(c, v) {
        var lines = ['Ping: ' + (v.ping === null || v.ping === undefined ? '—' : Math.round(v.ping) + ' ms')];
        if (DEBUG && v.debug) {
            var d = v.debug;
            if (v.isHost) {
                lines.push('kurucu · sim ' + d.simHz + ' Hz · gönderilen ' + d.sentHz + '/sn · gelen girdi ' + d.inputHz + '/sn');
            } else {
                lines.push('katılan · gelen durum ' + d.stateHz + ' Hz · tampon ' + d.bufferSize);
                lines.push('interp. gecikme ' + d.interpDelay + ' ms · ekstrapole ' + Math.round(d.extrapolatedMs) + ' ms');
                lines.push(d.predict ? 'tahmin hatası ' + d.predError.toFixed(1) + ' px (maks ' + d.predErrorMax.toFixed(1) +
                    ') · yeniden oynatma ' + d.replay + ' · ışınlanma ' + d.teleports + ' · onaysız ' + d.unacked : 'tahmin KAPALI');
            }
        }
        c.font = '11px monospace';
        c.textAlign = 'left';
        c.textBaseline = 'alphabetic';
        var w = 0;
        lines.forEach(function (l) { w = Math.max(w, c.measureText(l).width); });
        var h = lines.length * 14 + 6;
        c.fillStyle = 'rgba(10,20,40,0.6)';
        c.fillRect(4, K.H - h - 4, w + 10, h);
        c.fillStyle = '#d8f3ff';
        lines.forEach(function (l, i) { c.fillText(l, 9, K.H - h + 10 + i * 14); });
    }

    function drawParticles(c, dt) {
        for (var i = particles.length - 1; i >= 0; i--) {
            var p = particles[i];
            p.life -= dt;
            if (p.life <= 0) { particles.splice(i, 1); continue; }
            p.vy += 500 * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.rot += p.vr * dt;
            c.save();
            c.translate(p.x, p.y);
            c.rotate(p.rot);
            c.globalAlpha = Math.min(1, p.life);
            c.fillStyle = p.color;
            c.fillRect(-4, -2, 8, 4);
            c.restore();
        }
    }

    function spawnConfetti(x, y) {
        var colors = ['#ffd400', '#ff4d6d', '#2f80ed', '#35c759', '#ffffff', '#ff9f1c'];
        for (var i = 0; i < 90; i++) {
            var a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
            var sp = 180 + Math.random() * 380;
            particles.push({
                x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14,
                color: colors[Math.floor(Math.random() * colors.length)], life: 1.6 + Math.random() * 1.4
            });
        }
    }

    function drawBanner(c, t) {
        if (!banner) return;
        var k = (t - banner.born) / banner.dur;
        if (k >= 1) { banner = null; return; }
        var pop = k < 0.15 ? k / 0.15 : 1;
        c.save();
        c.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
        c.translate(K.W / 2, 190);
        c.scale(0.6 + 0.4 * pop, 0.6 + 0.4 * pop);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.lineWidth = 8;
        c.strokeStyle = 'rgba(0,0,0,0.6)';
        c.fillStyle = '#ffd400';
        c.font = 'bold 84px sans-serif';
        c.strokeText(banner.text, 0, 0);
        c.fillText(banner.text, 0, 0);
        if (banner.sub) {
            c.font = 'bold 28px sans-serif';
            c.lineWidth = 5;
            c.fillStyle = '#fff';
            c.strokeText(banner.sub, 0, 58);
            c.fillText(banner.sub, 0, 58);
        }
        c.restore();
    }

    function drawCountdown(c, frame) {
        if (frame.ph !== 0) return;
        var n = Math.ceil(frame.cd);
        if (n < 1) return;
        var frac = frame.cd - Math.floor(frame.cd - 1e-6);
        c.save();
        c.translate(K.W / 2, 200);
        var s = 0.8 + 0.4 * (frac > 0 ? frac : 1);
        c.scale(s, s);
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.font = 'bold 150px sans-serif';
        c.lineWidth = 10;
        c.strokeStyle = 'rgba(0,0,0,0.55)';
        c.fillStyle = '#fff';
        c.strokeText(String(n), 0, 0);
        c.fillText(String(n), 0, 0);
        c.restore();
    }

    var IDLE_FRAME = null;

    function idleFrame() {
        if (!IDLE_FRAME) IDLE_FRAME = K.frame(K.createState({ countdown: 0 }));
        return IDLE_FRAME;
    }

    function draw(t) {
        if (!ctx2d || !view) return;
        var dt = Math.min(0.1, Math.max(0, (t - lastDrawT) / 1000));
        lastDrawT = t;
        var frame = view.frame || idleFrame();
        var leftIdx = K.leftIndex(view.swap);

        // topun dönüşü
        if (lastBallX !== null) ballAngle += (frame.b[0] - lastBallX) / K.BALL_R;
        lastBallX = frame.b[0];

        drawBackground(ctx2d);
        drawGoal(ctx2d, true);
        drawGoal(ctx2d, false);
        for (var i = 0; i < 2; i++) {
            var side = i === leftIdx ? 0 : 1;
            drawPlayer(ctx2d, frame.p[i][0], frame.p[i][1], frame.p[i][2], side === 0 ? 1 : -1, TEAM_COLORS[side], playerFace(view, i));
        }
        drawBall(ctx2d, frame.b[0], frame.b[1]);
        drawParticles(ctx2d, dt);
        drawHud(ctx2d, view, frame);
        drawCountdown(ctx2d, frame);
        drawBanner(ctx2d, t);
    }

    // ---------- Katmanlar (HTML, yalnızca textContent) ----------
    function overlayCard(parts) {
        els.overlay.textContent = '';
        var card = el('div', 'kt-card');
        parts.forEach(function (p) { card.appendChild(p); });
        els.overlay.appendChild(card);
        els.overlay.classList.add('show');
    }

    function btn(label, className, handler, disabled) {
        var b = el('button', 'kt-btn ' + (className || ''), label);
        b.type = 'button';
        b.disabled = !!disabled;
        b.addEventListener('click', handler);
        return b;
    }

    function reasonText(reason) {
        return reason === 'time' ? 'Süre doldu' : (reason === 'golden' ? 'Altın gol' : 'Maç bitti');
    }

    function renderOverlay(v, t) {
        var sig;
        var showEnd = v.mode === 'over' && t >= endShowAt;
        if (v.mode === 'wait') {
            sig = ['wait', !!v.opponent, v.opponent && v.opponent.ready, v.room].join('|');
        } else if (showEnd) {
            sig = ['over', v.myVoted, v.opponentVoted, v.wins.join(','), v.result.winner, v.result.reason, v.result.score.join(',')].join('|');
        } else if (v.mode === 'abandoned') {
            sig = ['abandoned', v.isHost, v.room].join('|');
        } else {
            sig = 'none';
        }
        if (sig === overlaySignature) return;
        overlaySignature = sig;

        if (sig === 'none') {
            els.overlay.classList.remove('show');
            els.overlay.textContent = '';
            return;
        }
        if (v.mode === 'wait') {
            var parts = [el('strong', 'kt-card-title', v.opponent ? (v.opponent.ready ? 'Başlıyor…' : 'Rakip hazırlanıyor…') : 'Rakip bekleniyor…')];
            if (!v.opponent) {
                parts.push(el('span', 'kt-hint', 'Arkadaşına bu oda kodunu ver:'));
                parts.push(el('span', 'kt-room-code', v.room));
                parts.push(el('span', 'kt-hint', 'Ya da üstteki "Bağlantıyı Paylaş" ile davet gönder.'));
            } else {
                parts.push(el('span', 'kt-hint', v.opponent.name + ' ile oynuyorsun.'));
            }
            overlayCard(parts);
        } else if (showEnd) {
            var iWon = v.result.winner === v.me.index;
            var title = iWon ? '🏆 Kazandın!' : '😔 ' + (v.opponent ? v.opponent.name : 'Rakip') + ' kazandı';
            var leftIdx = K.leftIndex(v.swap);
            var scoreText = playerName(v, leftIdx) + ' ' + v.result.score[leftIdx] + ' : ' + v.result.score[1 - leftIdx] + ' ' + playerName(v, 1 - leftIdx);
            var rematchLabel = v.myVoted ? 'Rakip bekleniyor…' : (v.opponentVoted ? 'Rövanş (rakip hazır!)' : 'Rövanş (taraflar değişir)');
            overlayCard([
                el('strong', 'kt-card-title', title),
                el('span', 'kt-score-line', scoreText),
                el('span', 'kt-hint', reasonText(v.result.reason)),
                el('span', 'kt-session', 'Oturum skoru: ' + v.me.name + ' ' + v.wins[0] + ' – ' + v.wins[1] + ' ' + (v.opponent ? v.opponent.name : 'Rakip')),
                btn(rematchLabel, 'primary', function () { net.rematch(); }, v.myVoted),
                btn('Lobiye Dön', '', function () { gameCtx.leave(); })
            ]);
        } else if (v.mode === 'abandoned') {
            var ab = [el('strong', 'kt-card-title', 'Rakip ayrıldı')];
            if (v.isHost) {
                ab.push(el('span', 'kt-hint', 'Aynı kodla yeni biri katılırsa oyun yeniden başlar:'));
                ab.push(el('span', 'kt-room-code', v.room));
            } else {
                ab.push(el('span', 'kt-hint', 'Oda kurucusu ayrıldığı için oyun bitti.'));
            }
            ab.push(btn('Lobiye Dön', 'primary', function () { gameCtx.leave(); }));
            overlayCard(ab);
        }
    }

    function renderSetup(v) {
        var show = v.mode === 'setup';
        var sig = show ? 'setup' : 'stage';
        if (sig === setupSignature) return;
        setupSignature = sig;
        els.setup.classList.toggle('hidden', !show);
        els.stage.classList.toggle('hidden', show);
        els.rootEl.classList.toggle('in-stage', !show);
        if (!show) {
            stopCamera();
            window.requestAnimationFrame(resize);
        }
    }

    // ---------- Olaylar ----------
    function onNetEvent(ev) {
        var t = nowMs();
        var frame = (view && view.frame) || idleFrame();
        if (ev.type === 'goal') {
            var leftIdx = K.leftIndex(view ? view.swap : false);
            // gol yiyen kale: atan sağ taraftaysa sol kaleye gol atmıştır
            var scorerOnLeft = ev.scorer === leftIdx;
            spawnConfetti(scorerOnLeft ? K.W - 35 : 35, K.CROSSBAR_Y + 40);
            spawnConfetti(frame.b[0], Math.min(frame.b[1], 300));
            banner = { text: ev.golden ? 'ALTIN GOL!' : 'GOOOL!', sub: view ? playerName(view, ev.scorer) : '', born: t, dur: 1900 };
        } else if (ev.type === 'end') {
            endShowAt = t + END_OVERLAY_DELAY;
            if (ev.reason === 'time') endShowAt = t + 600;
            if (view) spawnConfetti(K.W / 2, 200);
        }
    }

    function onViewChange(v) {
        view = v;
        renderSetup(v);
        var t = nowMs();
        renderOverlay(v, t);
        els.toast.classList.toggle('show', !!v.stale);
        if (v.stale) els.toast.textContent = 'Rakipten veri gelmiyor… (rakibin sekmesi arka planda olabilir)';
    }

    // ---------- Döngü ----------
    function frameLoop(t) {
        rafId = requestAnimationFrame(frameLoop);
        if (!net) return;
        net.tick(t);                       // kurucu: sabit adımlı simülasyon; her iki taraf: görünümü günceller
        if (DEBUG && view && view.frame) {
            // e2e/elle ölçüm için: görüntülenen kendi karakter konumu ve ağ metrikleri
            window.__ktDebug = { x: view.frame.p[view.me.index][0], y: view.frame.p[view.me.index][1], mode: view.mode, ping: view.ping, debug: view.debug };
        }
        if (view && view.mode === 'over') renderOverlay(view, t);
        draw(t);
    }

    // ---------- init / destroy ----------
    function init(ctx) {
        gameCtx = ctx;
        document.body.classList.add('kt-active');
        els = buildDom();
        ctx2d = els.canvas.getContext('2d');
        crowd = buildCrowd();
        view = null;
        faceImages = {};
        particles = [];
        banner = null;
        endShowAt = 0;
        ballAngle = 0;
        lastBallX = null;
        lastDrawT = nowMs();
        overlaySignature = '';
        setupSignature = '';
        myFace = '😀';
        keyState = { left: false, right: false, jump: false, kick: false };
        buttonState = { left: false, right: false, jump: false, kick: false };

        // Yalnızca testler için: window.KAFATOPU_OPTIONS ile kısa maç gibi seçenekler verilebilir.
        var matchOptions = (typeof window !== 'undefined' && window.KAFATOPU_OPTIONS) || {};
        net = KafaTopuNet.create({
            ctx: ctx, rules: K, predictor: window.KafaTopuPredict, predict: !NO_PREDICT, now: nowMs, matchOptions: matchOptions,
            onChange: onViewChange, onEvent: onNetEvent
        });

        // yüz seçimi
        Array.prototype.forEach.call(els.emojiGrid.children, function (b) {
            listen(b, 'click', function () { setFaceChoice(b.dataset.face); setFaceMessage(''); });
        });
        listen(els.btnUpload, 'click', function () { els.file.click(); });
        listen(els.file, 'change', onFilePicked);
        listen(els.btnCamera, 'click', openCamera);
        listen(els.snap, 'click', captureFromCamera);
        listen(els.cancel, 'click', function () { stopCamera(); });
        listen(els.readyBtn, 'click', function () {
            stopCamera();
            net.setFace(myFace);
            net.ready();
        });

        // girdi
        listen(window, 'keydown', onKeyDown);
        listen(window, 'keyup', onKeyUp);
        listen(window, 'blur', releaseEverything);
        listen(document, 'visibilitychange', function () { if (document.hidden) releaseEverything(); });
        Object.keys(els.buttons).forEach(function (a) { bindButton(a, els.buttons[a]); });
        // sayfa kaymasın / yakınlaşmasın
        listen(document, 'touchmove', function (e) { if (document.body.classList.contains('kt-active') && !e.target.closest('.kt-setup')) e.preventDefault(); }, { passive: false });
        listen(document, 'gesturestart', function (e) { e.preventDefault(); });

        if (typeof ResizeObserver !== 'undefined') {
            resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(els.stage);
        }
        listen(window, 'resize', resize);

        setFaceChoice(myFace);
        resize();
        lastDrawT = nowMs();
        rafId = requestAnimationFrame(frameLoop);
    }

    function onMessage(data) {
        if (net) net.onMessage(data);
    }

    function destroy() {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
        stopCamera();
        if (resizeObserver) resizeObserver.disconnect();
        resizeObserver = null;
        listeners.forEach(function (off) { off(); });
        listeners = [];
        document.body.classList.remove('kt-active');
        if (gameCtx && gameCtx.root) gameCtx.root.textContent = '';
        els = null;
        ctx2d = null;
        net = null;
        view = null;
        gameCtx = null;
        faceImages = {};
        particles = [];
        banner = null;
        crowd = null;
    }

    Games.register({
        id: 'kafatopu',
        name: 'Kafa Topu',
        icon: '⚽',
        tagline: '2 oyuncu · gerçek zamanlı',
        maxPlayers: 2,
        init: init,
        onMessage: onMessage,
        destroy: destroy
    });
})();
