const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.static(path.join(__dirname, 'public')));

const QUIZ = [
    { difficulty:'easy', points:[50,45,40,35,30], image:'📖', question:'"Kitap kurdu" ne anlama gelir?', options:['Çok kitap okuyan','Kitap satan','Kitap yazan','Kitap eleştirmeni'], correct:0 },
    { difficulty:'easy', points:[50,45,40,35,30], image:'☕', question:'"Kahve falı" hangi şehirle özdeşleşmiştir?', options:['Ankara','İzmir','İstanbul','Kahramanmaraş'], correct:2 },
    { difficulty:'easy', points:[50,45,40,35,30], image:'🌉', question:'İstanbul Boğazı kaç kıtayı birbirine bağlar?', options:['1','2','3','4'], correct:1 },
    { difficulty:'medium', points:[75,70,65,60,55], image:'🎭', question:'"Bir taşla iki kuş" ne anlama gelir?', options:['Şanslı olmak','Bir işle iki sonuç','Hızlı davranmak','İkilemde kalmak'], correct:1 },
    { difficulty:'medium', points:[75,70,65,60,55], image:'✍️', question:'"Kürk Mantolu Madonna" kimin eseridir?', options:['Orhan Pamuk','Sabahattin Ali','Yaşar Kemal','Nazım Hikmet'], correct:1 },
    { difficulty:'medium', points:[75,70,65,60,55], image:'🏛️', question:'"Eskişehir" ne anlama gelir?', options:['Yeni şehir','Eski şehir','Büyük şehir','Küçük şehir'], correct:1 },
    { difficulty:'hard', points:[100,95,90,85,80], image:'📜', question:'"Lügat" kelimesinin Türkçe karşılığı?', options:['Sözlük','Kitap','Makale','Roman'], correct:0 },
    { difficulty:'hard', points:[100,95,90,85,80], image:'🎪', question:'Karagöz\'de Hacivat\'ın mesleği?', options:['Bakkal','Sarraf','Seyis','Çelebi'], correct:3 },
    { difficulty:'hard', points:[100,95,90,85,80], image:'🏺', question:'"Çini" sanatı Osmanlı\'da ne zaman zirveye ulaştı?', options:['Fatih','Kanuni','II. Selim','Tanzimat'], correct:1 }
];

const CELEBS = [
    ['Nasrettin Hoca','Malcolm X'],['Atatürk','Einstein'],
    ['Fatih Sultan Mehmet','Kleopatra'],['Yunus Emre','Shakespeare'],
    ['Evliya Çelebi','Marco Polo'],['Mevlana','Konfüçyüs'],
    ['Kanuni Sultan Süleyman','Napolyon'],['Hacı Bektaş Veli','Gandhi'],
    ['İbn-i Sina','Newton'],['Barbaros Hayreddin','Sezar']
];

const rooms = {};

function code4() {
    let c;
    do { c = Math.floor(1000+Math.random()*9000).toString(); } while(rooms[c]);
    return c;
}

function scores(room) {
    return [...room.players].sort((a,b)=>b.score-a.score).map(p=>({name:p.name,score:p.score,isHost:p.isHost}));
}

function norm(s) {
    return s.toLowerCase().trim().replace(/ı/g,'i').replace(/ğ/g,'g').replace(/ü/g,'u').replace(/ş/g,'s').replace(/ö/g,'o').replace(/ç/g,'c');
}

function lobby(code) {
    const r = rooms[code]; if(!r) return;
    io.to(code).emit('lobby_update', { players: r.players.map(p=>({name:p.name,isHost:p.isHost})) });
}

function nextQuestion(code) {
    const r = rooms[code]; if(!r) return;
    if(r.qIndex >= QUIZ.length) {
        r.state='ended';
        io.to(code).emit('game_over',{scores:scores(r),mode:'quiz'});
        return;
    }
    r.answered=[];
    clearTimeout(r.timer);
    const q = QUIZ[r.qIndex];
    io.to(code).emit('new_question',{
        index:r.qIndex, total:QUIZ.length,
        difficulty:q.difficulty, image:q.image,
        question:q.question, options:q.options, points:q.points
    });
    r.timer = setTimeout(()=>{
        io.to(code).emit('question_timeout',{correct:q.correct});
        setTimeout(()=>showScores(code), 2000);
    }, 45000);
}

function showScores(code) {
    const r = rooms[code]; if(!r) return;
    const isLast = r.qIndex >= QUIZ.length-1;
    io.to(code).emit('show_scores',{scores:scores(r), isLast});
    r.qIndex++;
    setTimeout(()=> isLast
        ? (r.state='ended', io.to(code).emit('game_over',{scores:scores(r),mode:'quiz'}))
        : nextQuestion(code)
    , 4000);
}

function nextRound(code) {
    const r = rooms[code]; if(!r) return;
    if(r.rIndex >= r.players.length) {
        r.state='ended';
        io.to(code).emit('game_over',{scores:scores(r),mode:'unlu'});
        return;
    }
    r.guessers=[]; r.celeb=null;
    clearInterval(r.tick);
    const narrator = r.players[r.rIndex];
    const pair = CELEBS[r.rIndex % CELEBS.length];
    io.to(code).emit('round_begin',{narratorName:narrator.name, narratorId:narrator.id, round:r.rIndex+1, total:r.players.length});
    io.to(narrator.id).emit('pick_celeb',{pair});
}

function startTick(code) {
    const r = rooms[code]; if(!r) return;
    clearInterval(r.tick);
    let t=60;
    io.to(code).emit('tick',{t});
    r.tick = setInterval(()=>{
        t--;
        io.to(code).emit('tick',{t});
        if(t<=0){ clearInterval(r.tick); endRound(code); }
    },1000);
}

function endRound(code) {
    const r = rooms[code]; if(!r) return;
    clearInterval(r.tick);
    const isLast = r.rIndex >= r.players.length-1;
    io.to(code).emit('round_end',{celeb:r.celeb, narratorName:r.players[r.rIndex]?.name, scores:scores(r), isLast});
    r.rIndex++;
    setTimeout(()=> isLast
        ? (r.state='ended', io.to(code).emit('game_over',{scores:scores(r),mode:'unlu'}))
        : nextRound(code)
    , 5000);
}

io.on('connection', socket=>{

    socket.on('create', data=>{
        const code=code4();
        rooms[code]={ code, mode:data.mode||null,
            players:[{id:socket.id,name:data.name||'Host',isHost:true,score:0}],
            state:'lobby', qIndex:0, answered:[], rIndex:0, celeb:null, guessers:[], timer:null, tick:null };
        socket.join(code); socket.roomCode=code; socket.pName=data.name||'Host';
        socket.emit('created',{code}); lobby(code);
    });

    socket.on('join', data=>{
        const r=rooms[data.code];
        if(!r){ socket.emit('err','Oda yok!'); return; }
        if(r.state!=='lobby'){ socket.emit('err','Oyun başladı!'); return; }
        r.players.push({id:socket.id,name:data.name,isHost:false,score:0});
        socket.join(data.code); socket.roomCode=data.code; socket.pName=data.name;
        socket.emit('joined',{code:data.code,name:data.name}); lobby(data.code);
    });

    socket.on('start', data=>{
        const r=rooms[data.code]; if(!r) return;
        const p=r.players.find(p=>p.id===socket.id); if(!p||!p.isHost) return;
        r.state='playing'; r.players.forEach(p=>p.score=0);
        io.to(data.code).emit('started',{mode:r.mode});
        if(r.mode==='quiz'){ r.qIndex=0; nextQuestion(data.code); }
        else { r.rIndex=0; nextRound(data.code); }
    });

    socket.on('answer', data=>{
        const r=rooms[data.code]; if(!r||r.state!=='playing') return;
        const p=r.players.find(p=>p.id===socket.id); if(!p||r.answered.includes(socket.id)) return;
        r.answered.push(socket.id);
        const q=QUIZ[r.qIndex];
        if(data.i===q.correct){
            const pts=q.points[Math.min(r.answered.length-1,q.points.length-1)];
            p.score+=pts;
            socket.emit('ans_result',{ok:true,pts});
        } else { socket.emit('ans_result',{ok:false,pts:0}); }
        io.to(data.code).emit('scores_live',scores(r));
    });

    socket.on('celeb_chosen', data=>{
        const r=rooms[data.code]; if(!r) return;
        r.celeb=data.celeb;
        socket.emit('celeb_ok',{celeb:data.celeb});
        io.to(data.code).emit('round_go',{narratorName:r.players[r.rIndex]?.name, round:r.rIndex+1, total:r.players.length});
        startTick(data.code);
    });

    socket.on('chat', data=>{
        const r=rooms[data.code]; if(!r) return;
        const p=r.players.find(p=>p.id===socket.id); if(!p) return;
        const isNarrator = socket.id===r.players[r.rIndex]?.id;
        if(isNarrator){
            io.to(data.code).emit('msg',{name:p.name,text:data.text,type:'narrator'});
        } else {
            if(r.celeb && norm(data.text)===norm(r.celeb) && !r.guessers.includes(socket.id)){
                r.guessers.push(socket.id);
                const pts=[50,45,40,35,30][Math.min(r.guessers.length-1,4)];
                p.score+=pts;
                socket.emit('msg',{name:'✅',text:`Doğru! +${pts} puan`,type:'correct'});
                io.to(data.code).emit('msg',{name:'🎉',text:`${p.name} doğru buldu! (${r.guessers.length}. kişi)`,type:'system'});
                io.to(data.code).emit('scores_live',scores(r));
                if(r.guessers.length>=r.players.length-1){ clearInterval(r.tick); setTimeout(()=>endRound(data.code),1000); }
            } else if(!r.celeb||norm(data.text)!==norm(r.celeb)){
                io.to(data.code).emit('msg',{name:p.name,text:data.text,type:'guess'});
            }
        }
    });

    socket.on('disconnect',()=>{
        const code=socket.roomCode; if(!code||!rooms[code]) return;
        const r=rooms[code];
        r.players=r.players.filter(p=>p.id!==socket.id);
        if(r.players.length===0){ clearTimeout(r.timer); clearInterval(r.tick); delete rooms[code]; }
        else { if(r.state==='lobby') lobby(code); io.to(code).emit('msg',{name:'👋',text:`${socket.pName} ayrıldı`,type:'system'}); }
    });
});

const PORT = process.env.PORT||3000;
server.listen(PORT,()=>console.log('OK:'+PORT));
