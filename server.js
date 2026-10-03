const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

let players = {};
let bombs = [];
let explosions = [];

io.on('connection', (socket) => {
    console.log('A user connected');

    players[socket.id] = { x: Math.floor(Math.random() * 760), y: Math.floor(Math.random() * 560), color: '#' + Math.floor(Math.random() * 16777215).toString(16) };

    socket.emit('playerMoved', players[socket.id]);

    socket.broadcast.emit('otherPlayers', players);

    socket.on('move', (data) => {
        players[socket.id].x += data.x;
        players[socket.id].y += data.y;

        socket.emit('playerMoved', players[socket.id]);
        socket.broadcast.emit('otherPlayers', players);
    });

    socket.on('placeBomb', () => {
        const bomb = { x: players[socket.id].x, y: players[socket.id].y, owner: socket.id };
        bombs.push(bomb);
        io.emit('bombPlaced', bomb);
    });

    socket.on('disconnect', () => {
        console.log('A user disconnected');
        delete players[socket.id];
        io.emit('otherPlayers', players);
    });
});

server.listen(3000, () => {
    console.log('Server running on port 3000');
});
