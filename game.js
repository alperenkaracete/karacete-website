const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

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
            player.y -= 5;
            // Boundary checking
            if (player.y < 0) player.y = 0;
            break;
        case 'ArrowDown':
            player.y += 5;
            // Boundary checking
            if (player.y > canvas.height - player.height) player.y = canvas.height - player.height;
            break;
        case 'ArrowLeft':
            player.x -= 5;
            // Boundary checking
            if (player.x < 0) player.x = 0;
            break;
        case 'ArrowRight':
            player.x += 5;
            // Boundary checking
            if (player.x > canvas.width - player.width) player.x = canvas.width - player.width;
            break;
        case ' ':
            placeBomb();
            break;
    }
}

function placeBomb() {
    const bomb = { 
        x: player.x, 
        y: player.y, 
        id: Date.now() // Unique ID for the bomb
    };
    bombs.push(bomb);
    
    // Remove bomb after a delay (simulating explosion)
    setTimeout(() => {
        const explosion = { x: bomb.x, y: bomb.y };
        explosions.push(explosion);
        
        // Remove explosion after a short time
        setTimeout(() => {
            explosions = explosions.filter(e => e !== explosion);
        }, 1000);
    }, 3000); // Bomb explodes after 3 seconds
}

document.addEventListener('keydown', handleKeyDown);

// Simulate other players (for demo purposes)
setInterval(() => {
    const randomPlayer = {
        x: Math.floor(Math.random() * (canvas.width - 20)),
        y: Math.floor(Math.random() * (canvas.height - 20)),
        color: '#' + Math.floor(Math.random() * 16777215).toString(16)
    };
    
    // Add some randomness to make it more interesting
    const playerId = `player_${Date.now()}_${Math.random()}`;
    otherPlayers[playerId] = randomPlayer;
    
    // Remove player after some time
    setTimeout(() => {
        delete otherPlayers[playerId];
    }, 5000);
}, 2000);

gameLoop();
