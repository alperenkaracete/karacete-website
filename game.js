const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// MATEMATİK DÜZELTİLDİ: 800x608 (İkisi de 32'ye tam bölünür: 25x19 grid)
canvas.width = 800;
canvas.height = 608;

const GRID_SIZE = 32;
const MAP_WIDTH = canvas.width / GRID_SIZE;
const MAP_HEIGHT = canvas.height / GRID_SIZE;

let player = { 
    id: "oyuncu_" + Math.floor(Math.random() * 10000),
    x: GRID_SIZE,
    y: GRID_SIZE,
    width: GRID_SIZE, 
    height: GRID_SIZE, 
    color: '#00FF00',
    name: '',
    isDead: false // YENİ: Oyuncunun hayatta olup olmadığını takip edeceğiz
};

let otherPlayers = {};
let bombs = [];
let explosions = [];
let map = [];

// YENİ: Yeniden başlatma oylaması
let restartVotes = new Set();

// --- SPRITE KOORDİNATLARI (Görsele Göre Milimetrik Ayarlandı) ---
const spriteSheet = new Image();
spriteSheet.src = 'assets/bomb_party_v4.png'; // Yol düzeltildi (Aynı klasörde olduğunu varsayıyoruz)

const SPRITES = {
    WALL: { sx: 0, sy: 0, width: 16, height: 16 },         // Dış Duvar ve İç Kolonlar (Koyu Gri)
    GRASS: { sx: 32, sy: 16, width: 16, height: 16 },      // Temiz Çim
    
    // İŞTE DÜZELTİLEN SATIR (Açık Gri Kırılabilir Kutu)
    BOX: { sx: 32, sy: 32, width: 16, height: 16 },        
    
    // Karakter
    PLAYER_DOWN: { sx: 0, sy: 224, width: 16, height: 16 },
    
    // Bomba ve Patlamalar
    BOMB: { sx: 64, sy: 288, width: 16, height: 16 },
    EXP_CENTER: { sx: 224, sy: 304, width: 16, height: 16 }, 
    EXP_HORIZ: { sx: 16, sy: 288, width: 16, height: 16 },   
    EXP_VERT: { sx: 224, sy: 224, width: 16, height: 16 }    
};

// --- HARİTA OLUŞTURMA (Ayrık Kutu Kurallı) ---
function createMap() {
    map = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        map[y] = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            
            if (x === 0 || x === MAP_WIDTH - 1 || y === 0 || y === MAP_HEIGHT - 1) {
                map[y][x] = 1; // Dış Çerçeve
            } 
            else if (x % 2 === 0 && y % 2 === 0) {
                map[y][x] = 1; // Sabit Kolonlar
            } 
            else if (Math.random() < 0.6) { // Kutular yan yana gelmeyeceği için ihtimali biraz artırdık
                // Yanında veya yukarısında kutu var mı kontrolü
                let hasAdjacentBox = false;
                if (x > 0 && map[y][x-1] === 2) hasAdjacentBox = true;
                if (y > 0 && map[y-1][x] === 2) hasAdjacentBox = true;
                
                if (!hasAdjacentBox) {
                    map[y][x] = 2; // Etrafı boşsa kutu koy
                } else {
                    map[y][x] = 0; // Yanında kutu varsa burayı boş bırak
                }
            } 
            else {
                map[y][x] = 0; // Zemin
            }
        }
    }
    
    // Oyuncuların doğma noktalarını temizle
    map[1][1] = 0; map[1][2] = 0; map[2][1] = 0;
}

// --- WEBSOCKET ---
let socket = null;
function connectWebSocket() {
    socket = new WebSocket('wss://compassionate-alignment-production-165c.up.railway.app/oyun-odasi');
    
    socket.onopen = function() { sendPosition(); };
    
    socket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        if (data.type === 'move') { otherPlayers[data.id] = data.playerInfo; }
        else if (data.type === 'bomb') { bombs.push(data.bombInfo); triggerExplosion(data.bombInfo, false); }
        else if (data.type === 'map_update') { map = data.map; }
        else if (data.type === 'player_disconnect') { delete otherPlayers[data.id]; }
        else if (data.type === 'player_death') { 
            otherPlayers[data.id].isDead = true; 
        }
        else if (data.type === 'restart_vote') {
            restartVotes.add(data.id);
            updateRestartButton();
        }
    };
}

function sendPosition() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'move', id: player.id, playerInfo: player }));
    }
}

function sendMapUpdate() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'map_update', map: map }));
    }
}

// YENİ: Yeniden başlatma butonunu güncelle
function updateRestartButton() {
    const totalPlayers = Object.keys(otherPlayers).length + 1;
    const button = document.getElementById('restart-btn');
    button.textContent = `Yeniden Başlat (${restartVotes.size}/${totalPlayers})`;
}

// --- ÇİZİM İŞLEMLERİ ---
function drawMap() {
    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            // Şeffaflık sorununu önlemek için HER HÜCREYE önce çim çiziyoruz
            ctx.drawImage(spriteSheet, SPRITES.GRASS.sx, SPRITES.GRASS.sy, SPRITES.GRASS.width, SPRITES.GRASS.height, x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
            
            // Eğer o hücrede Duvar veya Kutu varsa çimin üstüne çiziyoruz
            const tileType = map[y][x];
            let sprite = null;
            
            if (tileType === 1) sprite = SPRITES.WALL;
            else if (tileType === 2) sprite = SPRITES.BOX;
            
            if (sprite) {
                ctx.drawImage(spriteSheet, sprite.sx, sprite.sy, sprite.width, sprite.height, x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
            }
        }
    }
}

function drawPlayer(p) {
    // Ölü oyuncuları çizme
    if (p.isDead) return;
    
    ctx.drawImage(spriteSheet, SPRITES.PLAYER_DOWN.sx, SPRITES.PLAYER_DOWN.sy, SPRITES.PLAYER_DOWN.width, SPRITES.PLAYER_DOWN.height, p.x, p.y, GRID_SIZE, GRID_SIZE);
    
    if (p.name) {
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        // İsim okunabilsin diye arkasına siyah gölge (stroke) ekliyoruz
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        ctx.strokeText(p.name, p.x + GRID_SIZE/2, p.y - 5);
        ctx.fillText(p.name, p.x + GRID_SIZE/2, p.y - 5);
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    drawMap();
    
    // Sadece hayattaysa oyuncuyu çiz ve ateş kontrolü yap
    if (!player.isDead) {
        drawPlayer(player);
        checkFireCollision();
    }
    
    for (const id in otherPlayers) { drawPlayer(otherPlayers[id]); }
    
    for (const b of bombs) { ctx.drawImage(spriteSheet, SPRITES.BOMB.sx, SPRITES.BOMB.sy, SPRITES.BOMB.width, SPRITES.BOMB.height, b.x, b.y, GRID_SIZE, GRID_SIZE); }
    for (const e of explosions) {
        let s = SPRITES.EXP_CENTER;
        if(e.type === 'horizontal') s = SPRITES.EXP_HORIZ;
        if(e.type === 'vertical') s = SPRITES.EXP_VERT;
        ctx.drawImage(spriteSheet, s.sx, s.sy, s.width, s.height, e.x, e.y, GRID_SIZE, GRID_SIZE);
    }
    
    requestAnimationFrame(gameLoop);
}

// --- ÇARPIŞMA KONTROLÜ (Bomba Engeli Eklendi) ---
function checkCollision(x, y) {
    const gridX = Math.floor(x / GRID_SIZE);
    const gridY = Math.floor(y / GRID_SIZE);
    
    // 1. Harita Sınırı Kontrolü
    if (gridX < 0 || gridX >= MAP_WIDTH || gridY < 0 || gridY >= MAP_HEIGHT) return true;
    
    // 2. Duvar ve Kutu Kontrolü
    if (map[gridY][gridX] === 1 || map[gridY][gridX] === 2) return true;
    
    // 3. Bomba Kontrolü (Gidilecek hedefte bomba var mı?)
    for (const b of bombs) {
        const bombGridX = Math.floor(b.x / GRID_SIZE);
        const bombGridY = Math.floor(b.y / GRID_SIZE);
        
        if (gridX === bombGridX && gridY === bombGridY) {
            return true; // Hedefte bomba varsa geçiş yasak!
        }
    }
    
    return false; // Engel yoksa harekete izin ver
}

// --- ÖLÜM MEKANİĞİ ---
function checkFireCollision() {
    if (player.isDead) return;

    const gridX = Math.floor(player.x / GRID_SIZE);
    const gridY = Math.floor(player.y / GRID_SIZE);

    for (const e of explosions) {
        const expGridX = Math.floor(e.x / GRID_SIZE);
        const expGridY = Math.floor(e.y / GRID_SIZE);
        
        // Eğer oyuncunun koordinatları ile ateşin koordinatları eşleşirse ölür
        if (gridX === expGridX && gridY === expGridY) {
            die();
            break;
        }
    }
}

function die() {
    player.isDead = true;
    
    // İzleyici arayüzünü göster
    document.getElementById('spectator-ui').style.display = 'block';
    
    // Ölüm bilgisini WebSocket üzerinden diğer oyunculara bildir ki seni ekrandan silsinler
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'player_death', id: player.id }));
    }
}

function movePlayer(dx, dy) {
    const newX = player.x + dx;
    const newY = player.y + dy;
    if (!checkCollision(newX, newY)) {
        player.x = newX;
        player.y = newY;
        sendPosition();
    }
}

function placeBomb() {
    const b = { x: player.x, y: player.y, id: Date.now() };
    bombs.push(b);
    triggerExplosion(b, true);
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'bomb', bombInfo: b }));
    }
}

function triggerExplosion(bombInfo, isLocal) {
    setTimeout(() => {
        const gridX = Math.floor(bombInfo.x / GRID_SIZE);
        const gridY = Math.floor(bombInfo.y / GRID_SIZE);
        
        explosions.push({ x: bombInfo.x, y: bombInfo.y, type: 'center' });
        
        const dirs = [{dx:0, dy:-1, t:'vertical'}, {dx:0, dy:1, t:'vertical'}, {dx:1, dy:0, t:'horizontal'}, {dx:-1, dy:0, t:'horizontal'}];
        
        for (const d of dirs) {
            for (let i = 1; i <= 2; i++) {
                const cx = gridX + (d.dx * i);
                const cy = gridY + (d.dy * i);
                
                if (cx < 0 || cx >= MAP_WIDTH || cy < 0 || cy >= MAP_HEIGHT) break;
                if (map[cy][cx] === 1) break; // Sabit duvar patlamayı durdurur
                
                explosions.push({ x: cx * GRID_SIZE, y: cy * GRID_SIZE, type: d.t });
                
                if (map[cy][cx] === 2) {
                    if (isLocal) {
                        map[cy][cx] = 0; // Kutuyu kır
                        sendMapUpdate();
                    }
                    break; // Kutu kırıldıysa patlama arkasına geçmez
                }
            }
        }
        
        bombs = bombs.filter(b => b.id !== bombInfo.id);
        
        setTimeout(() => {
            explosions = explosions.filter(e => Math.abs(e.x - bombInfo.x) > GRID_SIZE * 2 || Math.abs(e.y - bombInfo.y) > GRID_SIZE * 2);
        }, 300); // Patlama efekti 0.3 saniye ekranda kalsın
    }, 3000); // Bomba 3 saniyede patlar
}

// YENİ: Oyunu sıfırla
function resetGame() {
    // Tüm oyuncuları yeniden başlat
    player.isDead = false;
    player.x = GRID_SIZE;
    player.y = GRID_SIZE;
    
    for (const id in otherPlayers) {
        otherPlayers[id].isDead = false;
        otherPlayers[id].x = GRID_SIZE;
        otherPlayers[id].y = GRID_SIZE;
    }
    
    // Haritayı sıfırla
    createMap();
    
    // Bombaları ve patlamaları temizle
    bombs = [];
    explosions = [];
    
    // Yeniden başlatma oylamasını sıfırla
    restartVotes.clear();
    
    // İzleyici arayüzünü gizle
    document.getElementById('spectator-ui').style.display = 'none';
    
    // Haritayı senkronize et (sadece en küçük ID'li oyuncu yapar)
    const playerIds = Object.keys(otherPlayers);
    const allPlayerIds = [...playerIds, player.id];
    allPlayerIds.sort();
    
    if (allPlayerIds[0] === player.id) {
        sendMapUpdate();
    }
}

// --- KONTROLLER ---
document.addEventListener('keydown', function(e) {
    if(document.getElementById('welcome-screen').style.display !== 'none') return; // Menüdeyken tuşları engelle
    if(player.isDead) return; // YENİ: Oyuncu ölüyse hiçbir tuş çalışmaz
    
    switch (e.key) {
        case 'ArrowUp': movePlayer(0, -GRID_SIZE); e.preventDefault(); break;
        case 'ArrowDown': movePlayer(0, GRID_SIZE); e.preventDefault(); break;
        case 'ArrowLeft': movePlayer(-GRID_SIZE, 0); e.preventDefault(); break;
        case 'ArrowRight': movePlayer(GRID_SIZE, 0); e.preventDefault(); break;
        case ' ': placeBomb(); e.preventDefault(); break; // Boşluk tuşu ile bomba koy
    }
});

// YENİ: Yeniden başlatma butonu olayı
document.getElementById('restart-btn').addEventListener('click', function() {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'restart_vote', id: player.id }));
        restartVotes.add(player.id);
        updateRestartButton();
        
        // Eğer oyuncu sayısı tamamsa oyunu sıfırla
        const totalPlayers = Object.keys(otherPlayers).length + 1;
        if (restartVotes.size >= totalPlayers) {
            resetGame();
        }
    }
});

// --- BAŞLATMA ---
document.getElementById('start-game-btn').addEventListener('click', function() {
    const nickname = document.getElementById('nickname-input').value.trim();
    if (nickname) {
        player.name = nickname;
        document.getElementById('welcome-screen').style.display = 'none';
        canvas.style.display = 'block';
        createMap();
        connectWebSocket();
        gameLoop();
    }
});

document.getElementById('nickname-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') document.getElementById('start-game-btn').click();
});
