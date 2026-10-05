(function () {
    const CANVAS_WIDTH = 800;
    const CANVAS_HEIGHT = 608;
    const GRID_SIZE = 32;
    const MAP_WIDTH = CANVAS_WIDTH / GRID_SIZE;
    const MAP_HEIGHT = CANVAS_HEIGHT / GRID_SIZE;

    const corners = [
        { x: 1, y: 1 },
        { x: MAP_WIDTH - 2, y: 1 },
        { x: 1, y: MAP_HEIGHT - 2 },
        { x: MAP_WIDTH - 2, y: MAP_HEIGHT - 2 }
    ];

    const spriteSheet = new Image();
    spriteSheet.src = 'assets/bomb_party_v4.png';

    const SPRITES = {
        WALL: { sx: 0, sy: 0, width: 16, height: 16 },
        GRASS: { sx: 32, sy: 16, width: 16, height: 16 },
        BOX: { sx: 32, sy: 32, width: 16, height: 16 },
        BOMB: { sx: 64, sy: 288, width: 16, height: 16 },
        EXP_CENTER: { sx: 224, sy: 304, width: 16, height: 16 },
        EXP_HORIZ: { sx: 16, sy: 288, width: 16, height: 16 },
        EXP_VERT: { sx: 224, sy: 224, width: 16, height: 16 }
    };

    const TEMPLATE = `
        <div id="scoreboard">
            <h3>🏆 Skorlar</h3>
            <ul id="score-list"></ul>
        </div>
        <div id="spectator-ui">
            <h2 id="end-title">GAME OVER</h2>
            <button id="restart-btn">Yeniden Başlat (0/1)</button>
        </div>
        <canvas id="game-canvas"></canvas>
        <div id="mobile-controls">
            <div id="joystick-zone">
                <div id="joystick-base">
                    <div id="joystick-knob"></div>
                </div>
            </div>
            <div id="action-pad">
                <button id="btn-bomb" class="control-btn action-btn">💣</button>
            </div>
        </div>`;

    // --- Oyun durumu (init'te sıfırlanır) ---
    let root = null;
    let canvas = null;
    let ctx = null;
    let room = null;
    let send = function () {};
    let player = null;
    let otherPlayers = {};
    let bombs = [];
    let explosions = [];
    let map = [];
    let restartVotes = new Set();
    let scores = {};
    let gameEnded = false;

    // --- Temizlik için takip edilenler ---
    let running = false;
    let rafId = null;
    let timers = new Set();
    let cleanups = [];
    let joystickDir = null;
    let moveInterval = null;

    function later(fn, ms) {
        const id = setTimeout(function () {
            timers.delete(id);
            fn();
        }, ms);
        timers.add(id);
    }

    function listen(target, type, handler, options) {
        target.addEventListener(type, handler, options);
        cleanups.push(function () { target.removeEventListener(type, handler, options); });
    }

    function createMap() {
        map = [];
        for (let y = 0; y < MAP_HEIGHT; y++) {
            map[y] = [];
            for (let x = 0; x < MAP_WIDTH; x++) {
                if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
                    map[y][x] = 1;
                }
                else if (x % 2 === 0 && y % 2 === 0) {
                    map[y][x] = 1;
                }
                else if (Math.random() < 0.6) {
                    let hasAdjacentBox = false;
                    if (x > 0 && map[y][x-1] === 2) hasAdjacentBox = true;
                    if (y > 0 && map[y-1][x] === 2) hasAdjacentBox = true;

                    map[y][x] = !hasAdjacentBox ? 2 : 0;
                }
                else {
                    map[y][x] = 0;
                }
            }
        }

        const safeZones = [
            [1,1], [1,2], [2,1],
            [MAP_WIDTH-2, 1], [MAP_WIDTH-3, 1], [MAP_WIDTH-2, 2],
            [1, MAP_HEIGHT-2], [1, MAP_HEIGHT-3], [2, MAP_HEIGHT-2],
            [MAP_WIDTH-2, MAP_HEIGHT-2], [MAP_WIDTH-3, MAP_HEIGHT-2], [MAP_WIDTH-2, MAP_HEIGHT-3]
        ];
        for (const zone of safeZones) {
            map[zone[1]][zone[0]] = 0;
        }
    }

    function onMessage(data) {
        if (data.type === 'move') {
            const isNew = !otherPlayers[data.id];
            otherPlayers[data.id] = data.playerInfo;

            // Senkronizasyon (El Sıkışma) ve Skor Kaydı
            if (isNew) {
                if (!scores[data.id]) scores[data.id] = { name: data.playerInfo.name, score: 0 };
                updateScoreboardUI();

                // Yeni birini görürsen, ona kendini tanıt!
                if (!player.isDead) sendPosition();
            }
        }
        else if (data.type === 'bomb') { bombs.push(data.bombInfo); triggerExplosion(data.bombInfo, false); }
        else if (data.type === 'map_update') { map = data.map; }
        else if (data.type === 'player_disconnect') {
            delete otherPlayers[data.id];
            checkWinCondition();
        }
        else if (data.type === 'player_death') {
            if (otherPlayers[data.id]) otherPlayers[data.id].isDead = true;
            checkWinCondition();
        }
        else if (data.type === 'restart_vote') {
            restartVotes.add(data.id);
            updateRestartButton();
        }
    }

    function sendPosition() {
        send({ type: 'move', id: player.id, playerInfo: player });
    }

    function sendMapUpdate() {
        send({ type: 'map_update', map: map });
    }

    // --- SKOR VE KAZANAN MEKANİKLERİ ---
    function updateScoreboardUI() {
        const list = document.getElementById('score-list');
        if (!list) return;

        list.innerHTML = '';
        if (!scores[player.id]) scores[player.id] = { name: player.name, score: 0 };

        // Puanlara göre büyükten küçüğe sırala
        const sortedScores = Object.values(scores).sort((a, b) => b.score - a.score);

        for (const s of sortedScores) {
            list.innerHTML += `<li>${s.name}: <strong>${s.score}</strong></li>`;
        }
    }

    function checkWinCondition() {
        if (gameEnded) return;

        const totalPlayers = Object.keys(otherPlayers).length + 1;
        if (totalPlayers <= 1) return; // Tek başına oynuyorsa bitirme

        let aliveCount = player.isDead ? 0 : 1;
        let aliveId = player.isDead ? null : player.id;
        let aliveName = player.isDead ? null : player.name;

        for (const id in otherPlayers) {
            if (!otherPlayers[id].isDead) {
                aliveCount++;
                aliveId = id;
                aliveName = otherPlayers[id].name;
            }
        }

        // Geriye sadece 1 kişi kaldıysa kazandı!
        if (aliveCount === 1 && aliveId) {
            handleWin(aliveId, aliveName);
        }
        // Aynı anda yandılarsa berabere
        else if (aliveCount === 0) {
            handleDraw();
        }
    }

    function handleWin(winnerId, winnerName) {
        gameEnded = true;

        if (!scores[winnerId]) scores[winnerId] = { name: winnerName, score: 0 };
        scores[winnerId].score++;
        updateScoreboardUI();

        const ui = document.getElementById('spectator-ui');
        const title = document.getElementById('end-title');

        if (winnerId === player.id) {
            title.innerHTML = "🏆 KAZANDIN! 🏆";
            title.style.color = "gold";
        } else {
            title.innerHTML = `🏆 KAZANAN:<br>${winnerName}`;
            title.style.color = "gold";
        }

        if (ui) ui.style.display = 'block';
    }

    function handleDraw() {
        gameEnded = true;
        const ui = document.getElementById('spectator-ui');
        const title = document.getElementById('end-title');
        title.innerHTML = "🤝 BERABERE 🤝";
        title.style.color = "orange";
        if (ui) ui.style.display = 'block';
    }

    function updateRestartButton() {
        const totalPlayers = Object.keys(otherPlayers).length + 1;
        const button = document.getElementById('restart-btn');
        if (button) button.textContent = `Yeniden Başlat (${restartVotes.size}/${totalPlayers})`;
    }

    function drawMap() {
        for (let y = 0; y < MAP_HEIGHT; y++) {
            for (let x = 0; x < MAP_WIDTH; x++) {
                ctx.drawImage(spriteSheet, SPRITES.GRASS.sx, SPRITES.GRASS.sy, SPRITES.GRASS.width, SPRITES.GRASS.height, x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);

                const tileType = map[y][x];

                if (tileType === 1) {
                    ctx.drawImage(spriteSheet, SPRITES.WALL.sx, SPRITES.WALL.sy, SPRITES.WALL.width, SPRITES.WALL.height, x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
                } else if (tileType === 2) {
                    ctx.drawImage(spriteSheet, SPRITES.BOX.sx, SPRITES.BOX.sy, SPRITES.BOX.width, SPRITES.BOX.height, x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
                }
                else if (tileType === 3) {
                    ctx.fillStyle = 'rgba(0, 150, 255, 0.4)';
                    ctx.fillRect(x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
                    ctx.fillStyle = 'white';
                    ctx.font = '20px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('💣', x * GRID_SIZE + GRID_SIZE/2, y * GRID_SIZE + GRID_SIZE/2 + 2);
                } else if (tileType === 4) {
                    ctx.fillStyle = 'rgba(255, 50, 0, 0.4)';
                    ctx.fillRect(x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
                    ctx.fillStyle = 'white';
                    ctx.font = '22px Arial';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('🔥', x * GRID_SIZE + GRID_SIZE/2, y * GRID_SIZE + GRID_SIZE/2 + 2);
                }
            }
        }
    }

    function drawPlayer(p) {
        if (p.isDead) return;

        let baseSx = 0;
        let flip = false;

        if (p.direction === 'right') baseSx = 48;
        else if (p.direction === 'up') baseSx = 96;
        else if (p.direction === 'left') { baseSx = 48; flip = true; }

        const sx = baseSx + (p.animFrame * 16);
        const cIndex = p.colorIndex !== undefined ? p.colorIndex : 0;
        const sy = 224 + (cIndex * 16);

        ctx.save();
        if (flip) {
            ctx.translate(p.x + GRID_SIZE, p.y);
            ctx.scale(-1, 1);
            ctx.drawImage(spriteSheet, sx, sy, 16, 16, 0, 0, GRID_SIZE, GRID_SIZE);
        } else {
            ctx.drawImage(spriteSheet, sx, sy, 16, 16, p.x, p.y, GRID_SIZE, GRID_SIZE);
        }
        ctx.restore();

        if (p.name) {
            ctx.fillStyle = 'white';
            ctx.font = 'bold 12px Arial';
            ctx.textAlign = 'center';
            ctx.strokeStyle = 'black';
            ctx.lineWidth = 3;
            ctx.strokeText(p.name, p.x + GRID_SIZE/2, p.y - 5);
            ctx.fillText(p.name, p.x + GRID_SIZE/2, p.y - 5);
        }
    }

    function gameLoop() {
        if (!running) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawMap();

        if (!player.isDead) {
            drawPlayer(player);
            checkFireCollision();
        }

        for (const id in otherPlayers) { drawPlayer(otherPlayers[id]); }

        for (const b of bombs) {
            ctx.drawImage(spriteSheet, SPRITES.BOMB.sx, SPRITES.BOMB.sy, SPRITES.BOMB.width, SPRITES.BOMB.height, b.x, b.y, GRID_SIZE, GRID_SIZE);
        }
        for (const e of explosions) {
            let s = SPRITES.EXP_CENTER;
            if (e.type === 'horizontal') s = SPRITES.EXP_HORIZ;
            if (e.type === 'vertical') s = SPRITES.EXP_VERT;
            ctx.drawImage(spriteSheet, s.sx, s.sy, s.width, s.height, e.x, e.y, GRID_SIZE, GRID_SIZE);
        }

        rafId = requestAnimationFrame(gameLoop);
    }

    function checkCollision(x, y) {
        const gridX = Math.floor(x / GRID_SIZE);
        const gridY = Math.floor(y / GRID_SIZE);

        if (gridX < 0 || gridX >= MAP_WIDTH || gridY < 0 || gridY >= MAP_HEIGHT) return true;

        if (map[gridY][gridX] === 1 || map[gridY][gridX] === 2) return true;

        for (const b of bombs) {
            const bombGridX = Math.floor(b.x / GRID_SIZE);
            const bombGridY = Math.floor(b.y / GRID_SIZE);
            if (gridX === bombGridX && gridY === bombGridY) return true;
        }

        return false;
    }

    function checkFireCollision() {
        if (player.isDead) return;

        const gridX = Math.floor(player.x / GRID_SIZE);
        const gridY = Math.floor(player.y / GRID_SIZE);

        for (const e of explosions) {
            const expGridX = Math.floor(e.x / GRID_SIZE);
            const expGridY = Math.floor(e.y / GRID_SIZE);

            if (gridX === expGridX && gridY === expGridY) {
                die();
                break;
            }
        }
    }

    function die() {
        if (player.isDead) return;
        player.isDead = true;

        send({ type: 'player_death', id: player.id });

        checkWinCondition();

        // Eğer biz ölünce oyun bitmediyse standart izleyici ekranını göster
        if (!gameEnded) {
            const ui = document.getElementById('spectator-ui');
            const title = document.getElementById('end-title');
            title.innerHTML = "GAME OVER - İzleyici Modu";
            title.style.color = "red";
            if (ui) ui.style.display = 'block';
        }
    }

    function movePlayer(dx, dy) {
        const newX = player.x + dx;
        const newY = player.y + dy;

        if (!checkCollision(newX, newY)) {
            player.x = newX;
            player.y = newY;

            const gridX = Math.floor(newX / GRID_SIZE);
            const gridY = Math.floor(newY / GRID_SIZE);
            const tile = map[gridY][gridX];

            if (tile === 3) {
                player.maxBombs++;
                map[gridY][gridX] = 0;
                sendMapUpdate();
            } else if (tile === 4) {
                player.bombRange++;
                map[gridY][gridX] = 0;
                sendMapUpdate();
            }

            sendPosition();
        }
    }

    function placeBomb() {
        const activeBombs = bombs.filter(b => b.ownerId === player.id).length;
        if (activeBombs >= player.maxBombs) return;

        const b = {
            x: player.x,
            y: player.y,
            id: Date.now(),
            ownerId: player.id,
            range: player.bombRange
        };

        bombs.push(b);
        triggerExplosion(b, true);

        send({ type: 'bomb', bombInfo: b });
    }

    function triggerExplosion(bombInfo, isLocal) {
        later(() => {
            const gridX = Math.floor(bombInfo.x / GRID_SIZE);
            const gridY = Math.floor(bombInfo.y / GRID_SIZE);

            const expId = Date.now() + Math.random();

            explosions.push({ x: bombInfo.x, y: bombInfo.y, type: 'center', expId: expId });

            const dirs = [{dx:0, dy:-1, t:'vertical'}, {dx:0, dy:1, t:'vertical'}, {dx:1, dy:0, t:'horizontal'}, {dx:-1, dy:0, t:'horizontal'}];

            for (const d of dirs) {
                for (let i = 1; i <= bombInfo.range; i++) {
                    const cx = gridX + (d.dx * i);
                    const cy = gridY + (d.dy * i);

                    if (cx < 0 || cx >= MAP_WIDTH || cy < 0 || cy >= MAP_HEIGHT) break;
                    if (map[cy][cx] === 1) break;

                    explosions.push({ x: cx * GRID_SIZE, y: cy * GRID_SIZE, type: d.t, expId: expId });

                    if (map[cy][cx] === 3 || map[cy][cx] === 4) {
                        if (isLocal) {
                            map[cy][cx] = 0;
                            sendMapUpdate();
                        }
                    }

                    if (map[cy][cx] === 2) {
                        if (isLocal) {
                            const rand = Math.random();
                            if (rand < 0.15) {
                                map[cy][cx] = 3;
                            } else if (rand < 0.30) {
                                map[cy][cx] = 4;
                            } else {
                                map[cy][cx] = 0;
                            }
                            sendMapUpdate();
                        }
                        break;
                    }
                }
            }

            bombs = bombs.filter(b => b.id !== bombInfo.id);

            later(() => {
                explosions = explosions.filter(e => e.expId !== expId);
            }, 300);
        }, 3000);
    }

    function resetGame() {
        gameEnded = false; // Oyun bitti durumunu sıfırla
        const newSpawn = corners[Math.floor(Math.random() * corners.length)];

        player.isDead = false;
        player.x = newSpawn.x * GRID_SIZE;
        player.y = newSpawn.y * GRID_SIZE;
        player.direction = 'down';
        player.animFrame = 0;
        player.maxBombs = 1;
        player.bombRange = 2;

        for (const id in otherPlayers) {
            otherPlayers[id].isDead = false;
        }

        createMap();
        bombs = [];
        explosions = [];
        restartVotes.clear();

        const ui = document.getElementById('spectator-ui');
        if (ui) ui.style.display = 'none';

        const playerIds = Object.keys(otherPlayers);
        const allPlayerIds = [...playerIds, player.id];
        allPlayerIds.sort();

        if (allPlayerIds[0] === player.id) {
            sendMapUpdate();
        }

        sendPosition();
        updateRestartButton(); // Buton metnini 0/X yap
    }

    function onKeyDown(e) {
        if (player.isDead || gameEnded) return; // Oyun bittiyse hareket edemez

        switch (e.key) {
            case 'ArrowUp':
                player.direction = 'up';
                player.animFrame = (player.animFrame + 1) % 3;
                movePlayer(0, -GRID_SIZE);
                e.preventDefault();
                break;
            case 'ArrowDown':
                player.direction = 'down';
                player.animFrame = (player.animFrame + 1) % 3;
                movePlayer(0, GRID_SIZE);
                e.preventDefault();
                break;
            case 'ArrowLeft':
                player.direction = 'left';
                player.animFrame = (player.animFrame + 1) % 3;
                movePlayer(-GRID_SIZE, 0);
                e.preventDefault();
                break;
            case 'ArrowRight':
                player.direction = 'right';
                player.animFrame = (player.animFrame + 1) % 3;
                movePlayer(GRID_SIZE, 0);
                e.preventDefault();
                break;
            case ' ': placeBomb(); e.preventDefault(); break;
        }
    }

    // --- MOBİL ÇEKMELİ JOYSTICK ---
    function handleMobileInput(direction) {
        if (player.isDead || gameEnded) return;

        if (direction === 'bomb') {
            placeBomb();
            return;
        }

        player.direction = direction;
        player.animFrame = (player.animFrame + 1) % 3;

        if (direction === 'up') movePlayer(0, -GRID_SIZE);
        else if (direction === 'down') movePlayer(0, GRID_SIZE);
        else if (direction === 'left') movePlayer(-GRID_SIZE, 0);
        else if (direction === 'right') movePlayer(GRID_SIZE, 0);
    }

    function startJoystickMovement(dir) {
        if (joystickDir === dir) return;
        joystickDir = dir;

        if (moveInterval) clearInterval(moveInterval);

        handleMobileInput(dir);

        moveInterval = setInterval(() => {
            handleMobileInput(joystickDir);
        }, 150);
    }

    function stopJoystickMovement() {
        const joystickKnob = document.getElementById('joystick-knob');
        joystickDir = null;
        if (moveInterval) {
            clearInterval(moveInterval);
            moveInterval = null;
        }
        if (joystickKnob) {
            joystickKnob.style.transition = "transform 0.2s ease-out";
            joystickKnob.style.transform = `translate(-50%, -50%)`;
        }
    }

    function handleJoystickDrag(e) {
        const joystickBase = document.getElementById('joystick-base');
        const joystickKnob = document.getElementById('joystick-knob');
        e.preventDefault();
        if (joystickKnob) joystickKnob.style.transition = "none";

        let clientX, clientY;
        if (e.type.includes('mouse')) {
            clientX = e.clientX;
            clientY = e.clientY;
        } else {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }

        const rect = joystickBase.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        let dx = clientX - centerX;
        let dy = clientY - centerY;

        const distance = Math.sqrt(dx * dx + dy * dy);
        const maxRadius = rect.width / 2;

        if (distance > maxRadius) {
            const ratio = maxRadius / distance;
            dx *= ratio;
            dy *= ratio;
        }

        if (joystickKnob) joystickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;

        if (distance < 15) {
            stopJoystickMovement();
            return;
        }

        if (Math.abs(dx) > Math.abs(dy)) {
            if (dx > 0) startJoystickMovement('right');
            else startJoystickMovement('left');
        } else {
            if (dy > 0) startJoystickMovement('down');
            else startJoystickMovement('up');
        }
    }

    function bindControls() {
        listen(document, 'keydown', onKeyDown);

        const restartBtn = document.getElementById('restart-btn');
        listen(restartBtn, 'click', function () {
            send({ type: 'restart_vote', id: player.id });
            restartVotes.add(player.id);
            updateRestartButton();

            const totalPlayers = Object.keys(otherPlayers).length + 1;
            if (restartVotes.size >= totalPlayers) {
                resetGame();
            }
        });

        const joystickBase = document.getElementById('joystick-base');
        listen(joystickBase, 'touchstart', handleJoystickDrag, { passive: false });
        listen(joystickBase, 'touchmove', handleJoystickDrag, { passive: false });
        listen(joystickBase, 'touchend', stopJoystickMovement);
        listen(joystickBase, 'touchcancel', stopJoystickMovement);

        let isDragging = false;
        listen(joystickBase, 'mousedown', (e) => { isDragging = true; handleJoystickDrag(e); });
        listen(document, 'mousemove', (e) => { if (isDragging) handleJoystickDrag(e); });
        listen(document, 'mouseup', () => { if (isDragging) { isDragging = false; stopJoystickMovement(); } });

        const btnBomb = document.getElementById('btn-bomb');
        listen(btnBomb, 'touchstart', (e) => { e.preventDefault(); handleMobileInput('bomb'); }, { passive: false });
        listen(btnBomb, 'mousedown', (e) => { e.preventDefault(); handleMobileInput('bomb'); });
    }

    function init(info) {
        root = info.root;
        room = info.room;
        send = info.send;
        root.innerHTML = TEMPLATE;

        canvas = document.getElementById('game-canvas');
        ctx = canvas.getContext('2d');
        canvas.width = CANVAS_WIDTH;
        canvas.height = CANVAS_HEIGHT;

        const spawnPoint = corners[Math.floor(Math.random() * corners.length)];
        player = {
            id: info.me.id,
            x: spawnPoint.x * GRID_SIZE,
            y: spawnPoint.y * GRID_SIZE,
            width: GRID_SIZE,
            height: GRID_SIZE,
            colorIndex: Math.floor(Math.random() * 4),
            name: info.me.name,
            isDead: false,
            direction: 'down',
            animFrame: 0,
            maxBombs: 1,
            bombRange: 2
        };

        otherPlayers = {};
        bombs = [];
        explosions = [];
        map = [];
        restartVotes = new Set();
        scores = {};
        gameEnded = false;
        joystickDir = null;

        updateScoreboardUI();
        canvas.style.display = 'block';
        document.getElementById('scoreboard').style.display = 'block';

        const mobileControls = document.getElementById('mobile-controls');
        if (window.innerWidth <= 850 && mobileControls) {
            mobileControls.style.display = 'flex';
        }

        bindControls();
        createMap();
        sendPosition();

        running = true;
        gameLoop();
    }

    function destroy() {
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        rafId = null;
        timers.forEach(clearTimeout);
        timers.clear();
        if (moveInterval) clearInterval(moveInterval);
        moveInterval = null;
        cleanups.forEach(function (fn) { fn(); });
        cleanups = [];
        if (root) root.innerHTML = '';
        otherPlayers = {};
        bombs = [];
        explosions = [];
    }

    Games.register({
        id: 'bomberman',
        name: 'Bomberman',
        maxPlayers: 4,
        init: init,
        onMessage: onMessage,
        destroy: destroy
    });
})();
