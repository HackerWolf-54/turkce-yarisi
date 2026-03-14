const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ============================================================
// VERİ
// ============================================================
const quizQuestions = [
    { difficulty:'easy', points:[50,45,40,35,30], image:'📖', question:'"Kitap kurdu" ifadesi ne anlama gelir?', options:['Çok kitap okuyan kişi','Kitap satan kişi','Kitap yazan kişi','Kitap eleştirmeni'], correct:0 },
    { difficulty:'easy', points:[50,45,40,35,30], image:'☕', question:'"Kahve falı" Türkiye\'nin hangi şehriyle özdeşleşmiştir?', options:['Ankara','İzmir','İstanbul','Kahramanmaraş'], correct:2 },
    { difficulty:'easy', points:[50,45,40,35,30], image:'🌉', question:'İstanbul\'u iki kıtaya bağlayan boğazın adı nedir?', options:['Çanakkale Boğazı','Marmara Boğazı','İstanbul Boğazı','Karadeniz Boğazı'], correct:2 },
    { difficulty:'medium', points:[75,70,65,60,55], image:'🎭', question:'"Bir taşla iki kuş" deyimi ne anlama gelir?', options:['Şanslı olmak','Bir işle iki sonuç elde etmek','Hızlı davranmak','İkilemde kalmak'], correct:1 },
    { difficulty:'medium', points:[75,70,65,60,55], image:'✍️', question:'"Kürk Mantolu Madonna" kimin eseridir?', options:['Orhan Pamuk','Sabahattin Ali','Yaşar Kemal','Nazım Hikmet'], correct:1 },
    { difficulty:'medium', points:[75,70,65,60,55], image:'🏛️', question:'"Eskişehir" kelimesinin anlamı nedir?', options:['Yeni şehir','Eski şehir','Büyük şehir','Küçük şehir'], correct:1 },
    { difficulty:'hard', points:[100,95,90,85,80], image:'📜', question:'"Lügat" kelimesinin modern Türkçe karşılığı nedir?', options:['Sözlük','Kitap','Makale','Roman'], correct:0 },
    { difficulty:'hard', points:[100,95,90,85,80], image:'🎪', question:'"Karagöz" geleneğinde Hacivat\'ın mesleği nedir?', options:['Bakkal','Sarraf','Seyis','Çelebi'], correct:3 },
    { difficulty:'hard', points:[100,95,90,85,80], image:'🏺', question:'"Çini" sanatı hangi dönemde Osmanlı\'da zirveye ulaştı?', options:['Fatih dönemi','Kanuni dönemi','II. Selim dönemi','Tanzimat dönemi'], correct:1 }
];

const celebPairs = [
    ['Nasrettin Hoca','Malcolm X'], ['Atatürk','Einstein'],
    ['Fatih Sultan Mehmet','Kleopatra'], ['Yunus Emre','Shakespeare'],
    ['Evliya Çelebi','Marco Polo'], ['Mevlana','Konfüçyüs'],
    ['Kanuni Sultan Süleyman','Napolyon'], ['Hacı Bektaş Veli','Gandhi'],
    ['İbn-i Sina','Newton'], ['Barbaros Hayreddin','Sezar'],
    ['Köroğlu','Robin Hood'], ['Dede Korkut','Homer'],
    ['Piri Reis','Macellan'], ['Fuzuli','Dante'],
    ['Karacaoğlan','Rumi'], ['Sinan Mimar','Michelangelo']
];

// ============================================================
// ODA YÖNETİMİ
// ============================================================
const rooms = {};

function generateCode() {
    let code;
    do { code = Math.floor(1000 + Math.random() * 9000).toString(); }
    while (rooms[code]);
    return code;
}

function getRoom(code) { return rooms[code]; }

function broadcastLobby(code) {
    const room = getRoom(code);
    if (!room) return;
    io.to(code).emit('lobby_update', {
        players: room.players.map(p => ({ name: p.name, isHost: p.isHost })),
        mode: room.mode
    });
}

// ============================================================
// SOCKET OLAYLARI
// ============================================================
io.on('connection', (socket) => {

    // HOST: Oda oluştur
    socket.on('create_room', ({ hostName, mode }) => {
        const code = generateCode();
        rooms[code] = {
            code,
            mode: mode || null,
            players: [{ id: socket.id, name: hostName || 'Host', isHost: true, score: 0 }],
            state: 'lobby',
            currentQuestion: 0,
            questionAnswered: [],
            currentRound: 0,
            currentCeleb: null,
            guessers: [],
            timer: null
        };
        socket.join(code);
        socket.roomCode = code;
        socket.playerName = hostName || 'Host';
        socket.emit('room_created', { code });
        broadcastLobby(code);
    });

    // HOST: Mod seç
    socket.on('set_mode', ({ code, mode }) => {
        const room = getRoom(code);
        if (!room) return;
        room.mode = mode;
        broadcastLobby(code);
    });

    // OYUNCU: Odaya katıl
    socket.on('join_room', ({ code, playerName }) => {
        const room = getRoom(code);
        if (!room) { socket.emit('error', 'Oda bulunamadı!'); return; }
        if (room.state !== 'lobby') { socket.emit('error', 'Oyun zaten başladı!'); return; }
        if (room.players.length >= 100) { socket.emit('error', 'Oda dolu!'); return; }

        room.players.push({ id: socket.id, name: playerName, isHost: false, score: 0 });
        socket.join(code);
        socket.roomCode = code;
        socket.playerName = playerName;
        socket.emit('joined_room', { code, playerName });
        broadcastLobby(code);
    });

    // HOST: Oyunu başlat
    socket.on('start_game', ({ code }) => {
        const room = getRoom(code);
        if (!room || !room.mode) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost) return;

        room.state = 'playing';
        io.to(code).emit('game_started', { mode: room.mode });

        if (room.mode === 'quiz') startQuiz(code);
        else startUnlu(code);
    });

    // QUIZ: Cevap ver
    socket.on('answer', ({ code, answerIndex }) => {
        const room = getRoom(code);
        if (!room || room.state !== 'playing') return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        if (room.questionAnswered.includes(socket.id)) return;

        const q = quizQuestions[room.currentQuestion];
        room.questionAnswered.push(socket.id);

        if (answerIndex === q.correct) {
            const rank = room.questionAnswered.filter(id => {
                const p2 = room.players.find(p => p.id === id);
                return p2 && id !== socket.id;
            }).length;
            const pts = q.points[Math.min(rank, q.points.length - 1)];
            player.score += pts;
            socket.emit('answer_result', { correct: true, points: pts });
        } else {
            socket.emit('answer_result', { correct: false, points: 0 });
        }

        io.to(code).emit('scores_update', getScores(room));
    });

    // ÜNLÜ ANLAT: Ünlü seç
    socket.on('choose_celeb', ({ code, celeb }) => {
        const room = getRoom(code);
        if (!room) return;
        room.currentCeleb = celeb;
        const narratorName = room.players[room.currentRound]?.name;
        // Sadece anlatıcıya ünlüyü gönder, diğerlerine sadece "başladı" haberi
        socket.emit('celeb_confirmed', { celeb });
        io.to(code).emit('round_started', {
            narratorName,
            round: room.currentRound + 1,
            totalRounds: room.players.length
        });
        startUnluTimer(code);
    });

    // ÜNLÜ ANLAT: Chat mesajı
    socket.on('chat_message', ({ code, message }) => {
        const room = getRoom(code);
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;

        const narratorId = room.players[room.currentRound]?.id;
        const isNarrator = socket.id === narratorId;

        if (isNarrator) {
            // Anlatıcının mesajını herkese gönder
            io.to(code).emit('chat_msg', { name: player.name, message, type: 'narrator' });
        } else {
            // Tahmin kontrolü
            const isCorrect = room.currentCeleb &&
                normalize(message) === normalize(room.currentCeleb);

            if (isCorrect && !room.guessers.includes(socket.id)) {
                room.guessers.push(socket.id);
                const rank = room.guessers.length - 1;
                const pts = [50, 45, 40, 35, 30][Math.min(rank, 4)];
                player.score += pts;

                // Sadece doğru bilene özel mesaj
                socket.emit('chat_msg', { name: 'Sistem', message: `✅ Doğru buldun! +${pts} puan 🎉`, type: 'correct_private' });
                // Herkese sadece "buldu" bildirimi
                io.to(code).emit('chat_msg', { name: 'Sistem', message: `🎉 ${player.name} doğru buldu! (${room.guessers.length}. kişi)`, type: 'system' });
                io.to(code).emit('scores_update', getScores(room));

                // Herkes buldu mu?
                const guessersNeeded = room.players.length - 1;
                if (room.guessers.length >= guessersNeeded) {
                    clearTimeout(room.timer);
                    setTimeout(() => endUnluRound(code), 1000);
                }
            } else if (!isCorrect) {
                // Yanlış tahmin — herkese göster
                io.to(code).emit('chat_msg', { name: player.name, message, type: 'guess' });
            } else {
                socket.emit('chat_msg', { name: 'Sistem', message: 'Zaten buldun!', type: 'system' });
            }
        }
    });

    // Bağlantı kesildi
    socket.on('disconnect', () => {
        const code = socket.roomCode;
        if (!code || !rooms[code]) return;
        const room = rooms[code];
        room.players = room.players.filter(p => p.id !== socket.id);
        if (room.players.length === 0) {
            clearTimeout(room.timer);
            delete rooms[code];
        } else {
            if (room.state === 'lobby') broadcastLobby(code);
            io.to(code).emit('player_left', { name: socket.playerName });
        }
    });
});

// ============================================================
// QUIZ FONKSİYONLARI
// ============================================================
function startQuiz(code) {
    const room = getRoom(code);
    if (!room) return;
    room.currentQuestion = 0;
    room.players.forEach(p => p.score = 0);
    sendQuestion(code);
}

function sendQuestion(code) {
    const room = getRoom(code);
    if (!room) return;
    if (room.currentQuestion >= quizQuestions.length) { endQuiz(code); return; }

    room.questionAnswered = [];
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

    // 45 saniye timer
    clearTimeout(room.timer);
    room.timer = setTimeout(() => {
        io.to(code).emit('question_timeout', { correct: q.correct });
        setTimeout(() => showQuizScores(code), 3000);
    }, 45000);
}

function showQuizScores(code) {
    const room = getRoom(code);
    if (!room) return;
    const q = quizQuestions[room.currentQuestion];
    const isLast = room.currentQuestion >= quizQuestions.length - 1;
    io.to(code).emit('show_quiz_scores', {
        scores: getScores(room),
        correctIndex: q.correct,
        isLast
    });
    // Sonraki soruya otomatik geç
    if (isLast) {
        setTimeout(() => endQuiz(code), 5000);
    } else {
        setTimeout(() => {
            room.currentQuestion++;
            sendQuestion(code);
        }, 5000);
    }
}

function endQuiz(code) {
    const room = getRoom(code);
    if (!room) return;
    room.state = 'ended';
    io.to(code).emit('game_over', { scores: getScores(room), mode: 'quiz' });
}

// ============================================================
// ÜNLÜ ANLAT FONKSİYONLARI
// ============================================================
function startUnlu(code) {
    const room = getRoom(code);
    if (!room) return;
    room.currentRound = 0;
    room.players.forEach(p => p.score = 0);
    startUnluRound(code);
}

function startUnluRound(code) {
    const room = getRoom(code);
    if (!room) return;
    if (room.currentRound >= room.players.length) { endUnlu(code); return; }

    room.guessers = [];
    room.currentCeleb = null;

    const narrator = room.players[room.currentRound];
    const pair = celebPairs[room.currentRound % celebPairs.length];

    // Herkese tur bilgisi
    io.to(code).emit('unlu_round_begin', {
        narratorName: narrator.name,
        narratorId: narrator.id,
        round: room.currentRound + 1,
        totalRounds: room.players.length
    });

    // Sadece anlatıcıya ünlü seçenekleri
    io.to(narrator.id).emit('choose_celeb_options', { pair });
}

function startUnluTimer(code) {
    const room = getRoom(code);
    if (!room) return;
    clearTimeout(room.timer);

    let timeLeft = 60;
    io.to(code).emit('timer_update', { timeLeft });

    const tick = setInterval(() => {
        timeLeft--;
        io.to(code).emit('timer_update', { timeLeft });
        if (timeLeft <= 0) {
            clearInterval(tick);
            endUnluRound(code);
        }
    }, 1000);

    room.timerInterval = tick;
}

function endUnluRound(code) {
    const room = getRoom(code);
    if (!room) return;
    clearInterval(room.timerInterval);

    const isLast = room.currentRound >= room.players.length - 1;
    io.to(code).emit('unlu_round_end', {
        celeb: room.currentCeleb,
        narratorName: room.players[room.currentRound]?.name,
        scores: getScores(room),
        isLast
    });

    room.currentRound++;

    // Sonraki tura otomatik geç
    if (isLast) {
        setTimeout(() => endUnlu(code), 6000);
    } else {
        setTimeout(() => startUnluRound(code), 6000);
    }
}

function endUnlu(code) {
    const room = getRoom(code);
    if (!room) return;
    room.state = 'ended';
    io.to(code).emit('game_over', { scores: getScores(room), mode: 'unlu' });
}

// ============================================================
// YARDIMCI
// ============================================================
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

// ============================================================
// SUNUCU
// ============================================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Sunucu çalışıyor: http://localhost:${PORT}`));
