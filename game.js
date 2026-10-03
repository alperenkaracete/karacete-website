const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

let player = { 
    id: "oyuncu_" + Math.floor(Math.random() * 10000),
    x: 50, 
    y: 50, 
    width: 20, 
    height: 20, 
    color: '#00FF00',
    name: ''
};
let otherPlayers = {};
let bombs = [];
let explosions = [];

canvas.width = 800;
canvas.height = 600;

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
// -----------------------------

function drawPlayer(x, y, color, name) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, player.width, player.height);
    
    // Oyuncu ismini karakterin üstüne yaz
    if (name) {
        ctx.fillStyle = 'white';
        ctx.font = '12px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(name, x + player.width/2, y - 5);
    }
}

function drawBomb(x, y) {
    ctx.fillStyle = '#FF0000';
    ctx.fillRect(x, y, 20, 20);
}

function drawExplosion(x, y) {
    ctx.fillStyle = '#FFFF00';
    ctx.fillRect(x - 20, y - 20, 60, 60);
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Oyuncuyu çiz
    drawPlayer(player.x, player.y, player.color, player.name);

    // Diğer oyuncuları çiz
    for (const id in otherPlayers) {
        drawPlayer(otherPlayers[id].x, otherPlayers[id].y, otherPlayers[id].color, otherPlayers[id].name);
    }

    for (const bomb of bombs) {
        drawBomb(bomb.x, bomb.y);
    }

    for (const explosion of explosions) {
        drawExplosion(explosion.x, explosion.y);
    }

    requestAnimationFrame(gameLoop);
}

function handleKeyDown(e) {
    let moved = false;
    switch (e.key) {
        case 'ArrowUp':
            player.y -= 5;
            if (player.y < 0) player.y = 0;
            moved = true;
            break;
        case 'ArrowDown':
            player.y += 5;
            if (player.y > canvas.height - player.height) player.y = canvas.height - player.height;
            moved = true;
            break;
        case 'ArrowLeft':
            player.x -= 5;
            if (player.x < 0) player.x = 0;
            moved = true;
            break;
        case 'ArrowRight':
            player.x += 5;
            if (player.x > canvas.width - player.width) player.x = canvas.width - player.width;
            moved = true;
            break;
        case ' ':
            placeBomb();
            break;
    }
    
    // Eğer oyuncu hareket ettiyse yeni koordinatları Spring Boot'a bildir
    if (moved) {
        sendPosition();
    }
}

function placeBomb() {
    const bombInfo = { x: player.x, y: player.y, id: Date.now() };
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

function triggerExplosion(bombInfo) {
    setTimeout(() => {
        const explosion = { x: bombInfo.x, y: bombInfo.y };
        explosions.push(explosion);
        
        setTimeout(() => {
            explosions = explosions.filter(e => e !== explosion);
        }, 1000);
        bombs = bombs.filter(b => b.id !== bombInfo.id); // Patlayan bombayı sil
    }, 3000);
}

// Oyun başlatma işlemi
document.getElementById('start-game-btn').addEventListener('click', function() {
    const nickname = document.getElementById('nickname-input').value.trim();
    
    if (nickname) {
        player.name = nickname;
        
        // Menüyü gizle ve oyunu başlat
        document.getElementById('welcome-screen').style.display = 'none';
        canvas.style.display = 'block';
        
        // WebSocket bağlantısını kur ve oyun döngüsünü başlat
        connectWebSocket();
        gameLoop();
    }
});

// Enter tuşu ile oyun başlatma
document.getElementById('nickname-input').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        document.getElementById('start-game-btn').click();
    }
});

// Oyun başlatma butonuna tıklama olayı
document.addEventListener('keydown', handleKeyDown);
