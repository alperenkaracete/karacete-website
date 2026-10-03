const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let player = { 
    id: "oyuncu_" + Math.floor(Math.random() * 10000),
    x: 50, 
    y: 50, 
    width: 32, 
    height: 32, 
    color: '#00FF00',
    name: ''
};
let otherPlayers = {};
let bombs = [];
let explosions = [];
let map = [];

// Sprite sheet ve sabitler
const spriteSheet = new Image();
spriteSheet.src = 'assets/bomb_party_v4.png';

const SPRITES = {
    GRASS: { sx: 0, sy: 0, width: 32, height: 32 },
    WALL: { sx: 32, sy: 0, width: 32, height: 32 },
    BOX: { sx: 64, sy: 0, width: 32, height: 32 },
    BOMB: { sx: 96, sy: 0, width: 32, height: 32 },
    EXPLOSION_CENTER: { sx: 128, sy: 0, width: 32, height: 32 },
    EXPLOSION_HORIZONTAL: { sx: 160, sy: 0, width: 32, height: 32 },
    EXPLOSION_VERTICAL: { sx: 192, sy: 0, width: 32, height: 32 },
    PLAYER_DOWN: { sx: 0, sy: 32, width: 32, height: 32 }
};

// Izgara boyutları
const GRID_SIZE = 32;
const MAP_WIDTH = canvas.width / GRID_SIZE;
const MAP_HEIGHT = canvas.height / GRID_SIZE;

// Harita oluşturma
function createMap() {
    map = [];
    
    // Başlangıç haritası
    for (let y = 0; y < MAP_HEIGHT; y++) {
        map[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            // Sabit duvarları satranç tahtası gibi yerleştir
            if ((x % 2 === 0 && y % 2 === 0) || 
                (x % 2 === 1 && y % 2 === 1)) {
                map[y][x] = 1; // Sabit duvar
            } else {
                map[y][x] = 0; // Zemin
            }
        }
    }
    
    // Kırılabilir kutuları rastgele yerleştir
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            // Oyuncu başlangıç noktalarını koru
            if ((x === 0 && y === 0) || 
                (x === MAP_WIDTH - 1 && y === MAP_HEIGHT - 1)) {
                map[y][x] = 0; // Zemin
            } else if (map[y][x] === 0 && Math.random() < 0.3) {
                map[y][x] = 2; // Kırılabilir kutu
            }
        }
    }
}

// Oyun başlatma
function initGame() {
    createMap();
    connectWebSocket();
    gameLoop();
}

// --- WEBSOCKET BAĞLANTISI ---
let socket = null;

function connectWebSocket() {
    // WebSocket bağlantısı sadece oyun başladığında kurulur
    socket = new WebSocket('wss://compassionate-alignment-production-165c.up.railway.app/oyun-odasi');
    
    socket.onopen = function() {
        console.log("Spring Boot sunucusuna bağlanıldı!");
        sendPosition(); // Bağlanınca ilk konumumuzu sunucuya gönder
    };

    socket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        
        // Eğer gelen mesaj bir oyuncu hareketi ise:
        if (data.type === 'move') {
            otherPlayers[data.id] = data.playerInfo;
        }
        // Eğer gelen mesaj bomba ise:
        else if (data.type === 'bomb') {
            bombs.push(data.bombInfo);
            triggerExplosion(data.bombInfo);
        }
        // Harita güncellemesi
        else if (data.type === 'map_update') {
            map = data.map;
        }
        // Oyuncu bağlantısı kesildi
        else if (data.type === 'player_disconnect') {
            delete otherPlayers[data.id];
        }
    };
    
    socket.onclose = function() {
        console.log("WebSocket bağlantısı kapatıldı");
        // Bağlantı kesildiğinde oyuncuyu sil
        if (otherPlayers[player.id]) {
            delete otherPlayers[player.id];
        }
    };
}

function sendPosition() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'move',
            id: player.id,
            playerInfo: player
        }));
    }
}

function sendMapUpdate() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'map_update',
            map: map
        }));
    }
}
// -----------------------------

// Harita çizimi
function drawMap() {
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const tileType = map[y][x];
            let sprite;
            
            switch (tileType) {
                case 0: // Zemin
                    sprite = SPRITES.GRASS;
                    break;
                case 1: // Sabit duvar
                    sprite = SPRITES.WALL;
                    break;
                case 2: // Kırılabilir kutu
                    sprite = SPRITES.BOX;
                    break;
            }
            
            if (sprite) {
                ctx.drawImage(
                    spriteSheet,
                    sprite.sx, sprite.sy, sprite.width, sprite.height,
                    x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE
                );
            }
        }
    }
}

// Oyuncu çizimi
function drawPlayer(x, y, color, name) {
    // Oyuncu sprite'ını çiz
    ctx.drawImage(
        spriteSheet,
        SPRITES.PLAYER_DOWN.sx, SPRITES.PLAYER_DOWN.sy, SPRITES.PLAYER_DOWN.width, SPRITES.PLAYER_DOWN.height,
        x, y, GRID_SIZE, GRID_SIZE
    );
    
    // Oyuncu ismini karakterin üstüne yaz
    if (name) {
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(name, x + GRID_SIZE/2, y - 5);
    }
}

// Bomba çizimi
function drawBomb(x, y) {
    ctx.drawImage(
        spriteSheet,
        SPRITES.BOMB.sx, SPRITES.BOMB.sy, SPRITES.BOMB.width, SPRITES.BOMB.height,
        x, y, GRID_SIZE, GRID_SIZE
    );
}

// Patlama çizimi
function drawExplosion(x, y, type) {
    let sprite;
    
    switch (type) {
        case 'center':
            sprite = SPRITES.EXPLOSION_CENTER;
            break;
        case 'horizontal':
            sprite = SPRITES.EXPLOSION_HORIZONTAL;
            break;
        case 'vertical':
            sprite = SPRITES.EXPLOSION_VERTICAL;
            break;
    }
    
    if (sprite) {
        ctx.drawImage(
            spriteSheet,
            sprite.sx, sprite.sy, sprite.width, sprite.height,
            x, y, GRID_SIZE, GRID_SIZE
        );
    }
}

// Çarpışma kontrolü
function checkCollision(x, y) {
    const gridX = Math.floor(x / GRID_SIZE);
    const gridY = Math.floor(y / GRID_SIZE);
    
    // Harita sınırlarını kontrol et
    if (gridX < 0 || gridX >= MAP_WIDTH || gridY < 0 || gridY >= MAP_HEIGHT) {
        return true;
    }
    
    // Engel var mı kontrol et
    const tileType = map[gridY][gridX];
    return tileType === 1 || tileType === 2; // Sabit duvar veya kutu
}

// Oyun döngüsü
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Haritayı çiz
    drawMap();
    
    // Oyuncuyu çiz
    drawPlayer(player.x, player.y, player.color, player.name);
    
    // Diğer oyuncuları çiz
    for (const id in otherPlayers) {
        const otherPlayer = otherPlayers[id];
        drawPlayer(otherPlayer.x, otherPlayer.y, otherPlayer.color, otherPlayer.name);
    }
    
    // Bombaları çiz
    for (const bomb of bombs) {
        drawBomb(bomb.x, bomb.y);
    }
    
    // Patlamaları çiz
    for (const explosion of explosions) {
        drawExplosion(explosion.x, explosion.y, explosion.type);
    }
    
    requestAnimationFrame(gameLoop);
}

// Oyuncu hareketi
function movePlayer(dx, dy) {
    const newX = player.x + dx;
    const newY = player.y + dy;
    
    // Çarpışma kontrolü
    if (!checkCollision(newX, newY)) {
        player.x = newX;
        player.y = newY;
        sendPosition();
    }
}

// Bomba yerleştirme
function placeBomb() {
    const bombInfo = { 
        x: Math.floor(player.x / GRID_SIZE) * GRID_SIZE,
        y: Math.floor(player.y / GRID_SIZE) * GRID_SIZE,
        id: Date.now()
    };
    
    // Bomba konumunu kontrol et (zemin olmalı)
    const gridX = Math.floor(bombInfo.x / GRID_SIZE);
    const gridY = Math.floor(bombInfo.y / GRID_SIZE);
    
    if (map[gridY][gridX] === 0) {
        bombs.push(bombInfo);
        triggerExplosion(bombInfo);
        
        // Bombayı diğer oyunculara gönder
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'bomb',
                bombInfo: bombInfo
            }));
        }
    }
}

// Patlama mekanikleri
function triggerExplosion(bombInfo) {
    const gridX = Math.floor(bombInfo.x / GRID_SIZE);
    const gridY = Math.floor(bombInfo.y / GRID_SIZE);
    
    // Patlama merkezi
    explosions.push({ x: bombInfo.x, y: bombInfo.y, type: 'center' });
    
    // Patlama ışınları (yukarı, aşağı, sağ, sol)
    const directions = [
        { dx: 0, dy: -1 }, // yukarı
        { dx: 0, dy: 1 },  // aşağı
        { dx: 1, dy: 0 },  // sağ
        { dx: -1, dy: 0 }  // sol
    ];
    
    // Patlama menzili
    const explosionRange = 2;
    
    for (const dir of directions) {
        for (let i = 1; i <= explosionRange; i++) {
            const checkX = gridX + (dir.dx * i);
            const checkY = gridY + (dir.dy * i);
            
            // Harita sınırlarını kontrol et
            if (checkX < 0 || checkX >= MAP_WIDTH || checkY < 0 || checkY >= MAP_HEIGHT) {
                break;
            }
            
            const tileType = map[checkY][checkX];
            
            // Sabit duvara çarparsa patlama durur
            if (tileType === 1) {
                break;
            }
            
            // Kırılabilir kutuya çarparsa kutuyu yok et
            if (tileType === 2) {
                map[checkY][checkX] = 0; // Kutuyu zemine dönüştür
                sendMapUpdate(); // Haritayı senkronize et
                break;
            }
            
            // Patlama ışını çiz
            const explosionX = checkX * GRID_SIZE;
            const explosionY = checkY * GRID_SIZE;
            
            // Yön bazlı patlama tipi belirle
            let type = 'horizontal';
            if (dir.dx === 0) {
                type = 'vertical';
            }
            
            explosions.push({ x: explosionX, y: explosionY, type: type });
        }
    }
    
    // Patlamayı sil
    setTimeout(() => {
        explosions = explosions.filter(e => e.x !== bombInfo.x || e.y !== bombInfo.y);
        
        // Bombayı sil
        bombs = bombs.filter(b => b.id !== bombInfo.id);
    }, 1000);
}

// Klavye olayları
function handleKeyDown(e) {
    switch (e.key) {
        case 'ArrowUp':
            movePlayer(0, -GRID_SIZE);
            break;
        case 'ArrowDown':
            movePlayer(0, GRID_SIZE);
            break;
        case 'ArrowLeft':
            movePlayer(-GRID_SIZE, 0);
            break;
        case 'ArrowRight':
            movePlayer(GRID_SIZE, 0);
            break;
        case ' ':
            placeBomb();
            break;
    }
}

// Oyun başlatma işlemi
document.getElementById('start-game-btn').addEventListener('click', function() {
    const nickname = document.getElementById('nickname-input').value.trim();
    
    if (nickname) {
        player.name = nickname;
        
        // Menüyü gizle ve oyunu başlat
        document.getElementById('welcome-screen').style.display = 'none';
        canvas.style.display = 'block';
        
        // Oyunu başlat
        initGame();
    }
});

// Enter tuşu ile oyun başlatma
document.getElementById('nickname-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        document.getElementById('start-game-btn').click();
    }
});

// Klavye olayı dinleyici
document.addEventListener('keydown', handleKeyDown);

// Sprite sheet yükleme
spriteSheet.onload = function() {
    // Sprite yüklendiğinde haritayı oluştur
    createMap();
};
