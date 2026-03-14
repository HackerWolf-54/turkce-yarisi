const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
 
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
 
app.use(express.static(path.join(__dirname, 'public')));
 
const quizQuestions = [
    { difficulty:'easy', points:[50,45,40,35,30], image:'📖', question:'"Kitap kurdu" ne anlama gelir?', options:['Çok kitap okuyan','Kitap satan','Kitap yazan','Kitap eleştirmeni'], correct:0 },
    { difficulty:'easy', points:[50,45,40,35,30], image:'☕', question:'"Kahve falı" hangi şehirle özdeşleşmiştir?', options:['Ankara','İzmir','İstanbul','Kahramanmaraş'], correct:2 },
    { difficulty:'easy', points:[50,45,40,35,30], image:'🌉', question:'İstanbul Boğazı kaç kıtayı birbirine bağlar?', options:['1','2','3','4'], correct:1 },
    { difficulty:'medium', points:[75,70,65,60,55], image:'🎭', question:'"Bir taşla iki kuş" ne anlama gelir?', options:['Şanslı olmak','Bir işle iki sonuç','Hızlı davranmak','İkilemde kalmak'], correct:1 },
    { difficulty:'medium', points:[75,70,65,60,55], image:'✍️', question:'"Kürk Mantolu Madonna" kimin eseridir?', options:['Orhan Pamuk','Sabahattin Ali','Yaşar Kemal','Nazım Hikmet'], correct:1 },
    { difficulty:'medium', points:[75,70,65,60,55], image:'🏛️', question:'"Eskişehir" kelimesinin anlamı nedir?', options:['Yeni şehir','Eski şehir','Büyük şehir','Küçük şehir'], correct:1 },
    { difficulty:'hard', points:[100,95,90,85,80], image:'📜', question:'"Lügat" kelimesinin Türkçe karşılığı nedir?', options:['Sözlük','Kitap','Makale','Roman'], correct:0 },
    { difficulty:'hard', points:[100,95,90,85,80], image:'🎪', question:'Karagöz geleneğinde Hacivat\'ın mesleği nedir?', options:['Bakkal','Sarraf','Seyis','Çelebi'], correct:3 },
    { difficulty:'hard', points:[100,95,90,85,80], image:'🏺', question:'"Çini" sanatı Osmanlı\'da hangi dönemde zirveye ulaştı?', options:['Fatih','Kanuni','II. Selim','Tanzimat'], correct:1 }
];
 
const celebPairs = [
    ['Nasrettin Hoca','Malcolm X'],['Atatürk','Einstein'],
    ['Fatih Sultan Mehmet','Kleopatra'],['Yunus Emre','Shakespeare'],
    ['Evliya Çelebi','Marco Polo'],['Mevlana','Konfüçyüs'],
    ['Kanuni Sultan Süleyman','Napolyon'],['Hacı Bektaş Veli','Gandhi'],
    ['İbn-i Sina','Newton'],['Barbaros Hayreddin','Sezar'],
    ['Köroğlu','Robin Hood'],['Dede Korkut','Homer']
];
 
const rooms = {};
 
function generateCode() {
    let code;
    do { code = Math.floor(1000 + Math.random() * 9000).toString(); }
    while (rooms[code]);
    return code;
}
 
function getScores(room) {
    return room.players
        .map(p => ({ name: p.name, score: p.score, isHost: p.isHost }))
        .sort((a, b) => b.score - a.score);
}
 
function normalize(s) {
    return s.toLowerCase().trim()
        .replace(/ı/g,'i').replace(/ğ/g,'g').replace(/ü/g,'u')
        .replace(/ş/g,'s').replace(/ö/g,'o').replace(/ç/g,'c');
}
 
function broadcastLobby(code) {
    const room = rooms[code];
    if (!room) return;
    io.to(code).emit('lobby_update', {
        players: room.players.map(p => ({ name: p.name, isHost: p.isHost })),
        mode: room.mode
    });
}
 
// ---- QUIZ ----
function sendQuestion(code) {
    const room = rooms[code];
    if (!room) return;
 
    if (room.currentQuestion >= quizQuestions.length) {
        room.state = 'ended';
        io.to(code).emit('game_over', { scores: getScores(room), mode: 'quiz' });
        return;
    }
 
    room.questionAnswered = [];
    clearTimeout(room.timer);
 
    const q = quizQuestions[room.currentQuestion];
    io.to(code).emit('new_question', {
        index: room.currentQuestion,
        total: quizQuestions.length,
        difficulty: q.difficulty,
        image: q.image,
        question: q.question,
        options: q.options,
        points: q.points
    });
 
    room.timer = setTimeout(() => {
        io.to(code).emit('question_timeout', { correct: q.correct });
        setTimeout(() => showQuizScores(code), 3000);
    }, 45000);
}
 
function showQuizScores(code) {
    const room = rooms[code];
    if (!room) return;
 
    const isLast = room.currentQuestion >= quizQuestions.length - 1;
    io.to(code).emit('show_quiz_scores', {
        scores: getScores(room),
        isLast: isLast
    });
 
    room.currentQuestion++;
 
    if (isLast) {
        setTimeout(() => {
            room.state = 'ended';
            io.to(code).emit('game_over', { scores: getScores(room), mode: 'quiz' });
        }, 5000);
    } else {
        setTimeout(() => sendQuestion(code), 5000);
    }
}
 
// ---- UNLU ----
function startUnluRound(code) {
    const room = rooms[code];
    if (!room) return;
 
    if (room.currentRound >= room.players.length) {
        room.state = 'ended';
        io.to(code).emit('game_over', { scores: getScores(room), mode: 'unlu' });
        return;
    }
 
    room.guessers = [];
    room.currentCeleb = null;
    clearInterval(room.timerInterval);
 
    const narrator = room.players[room.currentRound];
    const pair = celebPairs[room.currentRound % celebPairs.length];
 
    io.to(code).emit('unlu_round_begin', {
        narratorName: narrator.name,
        narratorId: narrator.id,
        round: room.currentRound + 1,
        totalRounds: room.players.length
    });
 
    io.to(narrator.id).emit('choose_celeb_options', { pair });
}
 
function startUnluTimer(code) {
    const room = rooms[code];
    if (!room) return;
    clearInterval(room.timerInterval);
 
    let timeLeft = 60;
    io.to(code).emit('timer_update', { timeLeft });
 
    room.timerInterval = setInterval(() => {
        timeLeft--;
        io.to(code).emit('timer_update', { timeLeft });
        if (timeLeft <= 0) {
            clearInterval(room.timerInterval);
            endUnluRound(code);
        }
    }, 1000);
}
 
function endUnluRound(code) {
    const room = rooms[code];
    if (!room) return;
    clearInterval(room.timerInterval);
 
    const isLast = room.currentRound >= room.players.length - 1;
    io.to(code).emit('unlu_round_end', {
        celeb: room.currentCeleb,
        narratorName: room.players[room.currentRound]?.name,
        scores: getScores(room),
        isLast: isLast
    });
 
    room.currentRound++;
 
    if (isLast) {
        setTimeout(() => {
            room.state = 'ended';
            io.to(code).emit('game_over', { scores: getScores(room), mode: 'unlu' });
        }, 6000);
    } else {
        setTimeout(() => startUnluRound(code), 6000);
    }
}
 
// ---- SOCKET EVENTS ----
io.on('connection', (socket) => {
 
    socket.on('create_room', (data) => {
        const code = generateCode();
        rooms[code] = {
            code, mode: data.mode || null,
            players: [{ id: socket.id, name: data.hostName || 'Host', isHost: true, score: 0 }],
            state: 'lobby', currentQuestion: 0, questionAnswered: [],
            currentRound: 0, currentCeleb: null, guessers: [],
            timer: null, timerInterval: null
        };
        socket.join(code);
        socket.roomCode = code;
        socket.playerName = data.hostName || 'Host';
        socket.emit('room_created', { code });
        broadcastLobby(code);
    });
 
    socket.on('set_mode', (data) => {
        const room = rooms[data.code];
        if (!room) return;
        room.mode = data.mode;
        broadcastLobby(data.code);
    });
 
    socket.on('join_room', (data) => {
        const room = rooms[data.code];
        if (!room) { socket.emit('join_error', 'Oda bulunamadı!'); return; }
        if (room.state !== 'lobby') { socket.emit('join_error', 'Oyun başladı!'); return; }
        if (room.players.length >= 100) { socket.emit('join_error', 'Oda dolu!'); return; }
 
        room.players.push({ id: socket.id, name: data.playerName, isHost: false, score: 0 });
        socket.join(data.code);
        socket.roomCode = data.code;
        socket.playerName = data.playerName;
        socket.emit('joined_room', { code: data.code, playerName: data.playerName });
        broadcastLobby(data.code);
    });
 
    socket.on('start_game', (data) => {
        const room = rooms[data.code];
        if (!room || !room.mode) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost) return;
 
        room.state = 'playing';
        room.players.forEach(p => p.score = 0);
        io.to(data.code).emit('game_started', { mode: room.mode });
 
        if (room.mode === 'quiz') {
            room.currentQuestion = 0;
            sendQuestion(data.code);
        } else {
            room.currentRound = 0;
            startUnluRound(data.code);
        }
    });
 
    socket.on('answer', (data) => {
        const room = rooms[data.code];
        if (!room || room.state !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || room.questionAnswered.includes(socket.id)) return;
 
        room.questionAnswered.push(socket.id);
        const q = quizQuestions[room.currentQuestion];
 
        if (data.answerIndex === q.correct) {
            const rank = room.questionAnswered.length - 1;
            const pts = q.points[Math.min(rank, q.points.length - 1)];
            player.score += pts;
            socket.emit('answer_result', { correct: true, points: pts });
        } else {
            socket.emit('answer_result', { correct: false, points: 0 });
        }
        io.to(data.code).emit('scores_update', getScores(room));
    });
 
    socket.on('choose_celeb', (data) => {
        const room = rooms[data.code];
        if (!room) return;
        room.currentCeleb = data.celeb;
        socket.emit('celeb_confirmed', { celeb: data.celeb });
        io.to(data.code).emit('round_started', {
            narratorName: room.players[room.currentRound - 0]?.name,
            round: room.currentRound + 1,
            totalRounds: room.players.length
        });
        startUnluTimer(data.code);
    });
 
    socket.on('chat_message', (data) => {
        const room = rooms[data.code];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
 
        const narratorId = room.players[room.currentRound]?.id;
 
        if (socket.id === narratorId) {
            io.to(data.code).emit('chat_msg', { name: player.name, message: data.message, type: 'narrator' });
        } else {
            const isCorrect = room.currentCeleb && normalize(data.message) === normalize(room.currentCeleb);
            if (isCorrect && !room.guessers.includes(socket.id)) {
                room.guessers.push(socket.id);
                const pts = [50,45,40,35,30][Math.min(room.guessers.length - 1, 4)];
                player.score += pts;
                socket.emit('chat_msg', { name: 'Sistem', message: `✅ Doğru! +${pts} puan 🎉`, type: 'correct_private' });
                io.to(data.code).emit('chat_msg', { name: 'Sistem', message: `🎉 ${player.name} doğru buldu! (${room.guessers.length}. kişi)`, type: 'system' });
                io.to(data.code).emit('scores_update', getScores(room));
                if (room.guessers.length >= room.players.length - 1) {
                    clearInterval(room.timerInterval);
                    setTimeout(() => endUnluRound(data.code), 1000);
                }
            } else if (!isCorrect) {
                io.to(data.code).emit('chat_msg', { name: player.name, message: data.message, type: 'guess' });
            } else {
                socket.emit('chat_msg', { name: 'Sistem', message: 'Zaten buldun!', type: 'system' });
            }
        }
    });
 
    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
            clearTimeout(room.timer);
            clearInterval(room.timerInterval);
            delete rooms[code];
        } else {
            if (room.state === 'lobby') broadcastLobby(code);
            io.to(code).emit('player_left', { name: socket.playerName });
        }
    });
});
 
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('Sunucu: http://localhost:' + PORT));
