const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const socket = io();

let player = { x: 50, y: 50, width: 20, height: 20, color: '#00FF00' };
let otherPlayers = {};
let bombs = [];
let explosions = [];

canvas.width = 800;
canvas.height = 600;

function drawPlayer(x, y, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, player.width, player.height);
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

    drawPlayer(player.x, player.y, player.color);

    for (const id in otherPlayers) {
        drawPlayer(otherPlayers[id].x, otherPlayers[id].y, otherPlayers[id].color);
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
    switch (e.key) {
        case 'ArrowUp':
            socket.emit('move', { x: 0, y: -5 });
            break;
        case 'ArrowDown':
            socket.emit('move', { x: 0, y: 5 });
            break;
        case 'ArrowLeft':
            socket.emit('move', { x: -5, y: 0 });
            break;
        case 'ArrowRight':
            socket.emit('move', { x: 5, y: 0 });
            break;
        case ' ':
            socket.emit('placeBomb');
            break;
    }
}

document.addEventListener('keydown', handleKeyDown);

socket.on('playerMoved', (data) => {
    player.x = data.x;
    player.y = data.y;
});

socket.on('otherPlayers', (players) => {
    otherPlayers = players;
});

socket.on('bombPlaced', (bomb) => {
    bombs.push(bomb);
});

socket.on('explosion', (explosion) => {
    explosions.push(explosion);
});

gameLoop();
