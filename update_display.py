import sys

html_content = r"""<!DOCTYPE html>
<html lang="uz">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>L-Lab Smart Doska - Jonli O'yin</title>
    <!-- Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800;900&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">

    <!-- Supabase & Plugins -->
    <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
    <script src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.6.0/dist/confetti.browser.min.js"></script>

    <style>
        :root {
            --bg-dark: #0f172a;
            --bg-card: rgba(30, 41, 59, 0.7);
            --primary: #3b82f6;
            --secondary: #8b5cf6;
            --success: #10b981;
            --danger: #ef4444;
            --warning: #f59e0b;
            --text-light: #f8fafc;
            --text-muted: #94a3b8;

            --opt-a: #ef4444; /* Red */
            --opt-b: #3b82f6; /* Blue */
            --opt-c: #f59e0b; /* Yellow */
            --opt-d: #10b981; /* Green */
        }

        body {
            font-family: 'Outfit', sans-serif;
            background: var(--bg-dark);
            background-image:
                radial-gradient(at 10% 10%, rgba(59, 130, 246, 0.3) 0px, transparent 50%),
                radial-gradient(at 90% 90%, rgba(139, 92, 246, 0.3) 0px, transparent 50%);
            color: var(--text-light);
            margin: 0;
            padding: 0;
            height: 100vh;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        /* Top Bar */
        .top-bar {
            padding: 1.5rem 3rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(15, 23, 42, 0.8);
            backdrop-filter: blur(10px);
            border-bottom: 2px solid rgba(255, 255, 255, 0.1);
            z-index: 10;
        }
        .top-bar .title {
            font-size: 2.5rem;
            font-weight: 900;
            background: linear-gradient(135deg, #60a5fa, #c084fc);
            -webkit-background-clip: text;
            background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .top-bar .status {
            font-size: 1.8rem;
            font-weight: 700;
            background: rgba(255, 255, 255, 0.1);
            padding: 0.8rem 1.5rem;
            border-radius: 20px;
        }

        /* Screens */
        .screen {
            display: none;
            flex: 1;
            padding: 3rem;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            animation: fadeIn 0.5s ease-out;
        }
        .screen.active {
            display: flex;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* --- LOBBY SCREEN --- */
        .lobby-title {
            font-size: 6rem;
            font-weight: 900;
            margin-bottom: 1rem;
            text-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
            text-align: center;
        }
        .lobby-subtitle {
            font-size: 3rem;
            font-weight: 700;
            color: var(--warning);
            margin-bottom: 4rem;
            text-align: center;
            animation: pulseText 2s infinite;
        }
        @keyframes pulseText {
            0% { transform: scale(1); opacity: 0.8; }
            50% { transform: scale(1.05); opacity: 1; }
            100% { transform: scale(1); opacity: 0.8; }
        }
        .students-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 2rem;
            width: 100%;
            max-width: 1600px;
        }
        .student-card {
            background: var(--bg-card);
            border: 3px solid rgba(255, 255, 255, 0.1);
            border-radius: 1.5rem;
            padding: 2rem;
            text-align: center;
            font-size: 2rem;
            font-weight: 700;
            color: var(--text-muted);
            transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            backdrop-filter: blur(8px);
        }
        .student-card.joined {
            border-color: var(--success);
            color: white;
            background: rgba(16, 185, 129, 0.2);
            box-shadow: 0 0 30px rgba(16, 185, 129, 0.5);
            transform: scale(1.05);
        }

        /* --- QUESTION SCREEN --- */
        .question-container {
            width: 100%;
            max-width: 1600px;
            display: flex;
            flex-direction: column;
            gap: 3rem;
            flex: 1;
            justify-content: center;
        }
        .question-text {
            font-size: 5rem;
            font-weight: 900;
            text-align: center;
            background: var(--bg-card);
            padding: 4rem;
            border-radius: 2rem;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
            line-height: 1.3;
        }
        .options-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
        }
        .option-btn {
            padding: 3rem;
            font-size: 3.5rem;
            font-weight: 800;
            border-radius: 2rem;
            display: flex;
            align-items: center;
            gap: 2rem;
            background: rgba(255, 255, 255, 0.05);
            border: 4px solid transparent;
            box-shadow: 0 8px 20px rgba(0,0,0,0.3);
        }
        .option-btn.opt-0 { border-color: var(--opt-a); color: var(--opt-a); }
        .option-btn.opt-1 { border-color: var(--opt-b); color: var(--opt-b); }
        .option-btn.opt-2 { border-color: var(--opt-c); color: var(--opt-c); }
        .option-btn.opt-3 { border-color: var(--opt-d); color: var(--opt-d); }

        .option-btn .badge {
            width: 80px;
            height: 80px;
            border-radius: 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 3rem;
            flex-shrink: 0;
        }
        .option-btn.opt-0 .badge { background: var(--opt-a); }
        .option-btn.opt-1 .badge { background: var(--opt-b); }
        .option-btn.opt-2 .badge { background: var(--opt-c); }
        .option-btn.opt-3 .badge { background: var(--opt-d); }

        /* Top Progress Bar for Timer */
        .timer-bar {
            position: absolute;
            top: 0; left: 0;
            width: 100%;
            height: 20px;
            background: rgba(255, 255, 255, 0.1);
            z-index: 100;
        }
        .timer-fill {
            height: 100%;
            width: 100%;
            background: linear-gradient(90deg, var(--success), var(--warning), var(--danger));
            transform-origin: left;
            transition: transform 1s linear;
        }

        /* --- LEADERBOARD SCREEN --- */
        .leaderboard-container {
            display: flex;
            width: 100%;
            max-width: 1500px;
            gap: 4rem;
            height: 80vh;
        }
        .rankings-col {
            flex: 2;
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
            overflow-y: auto;
            padding-right: 2rem;
        }
        .rankings-col::-webkit-scrollbar { width: 0; }
        
        .rank-card {
            display: flex;
            align-items: center;
            background: var(--bg-card);
            padding: 2rem 3rem;
            border-radius: 1.5rem;
            font-size: 2.5rem;
            font-weight: 800;
            gap: 2rem;
            box-shadow: 0 10px 30px rgba(0,0,0,0.3);
            border: 2px solid transparent;
        }
        .rank-number {
            width: 70px;
            height: 70px;
            border-radius: 50%;
            background: rgba(255, 255, 255, 0.1);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2.5rem;
            flex-shrink: 0;
        }
        .rank-card:nth-child(1) { border-color: #fbbf24; transform: scale(1.02); }
        .rank-card:nth-child(1) .rank-number { background: #fbbf24; color: #000; box-shadow: 0 0 30px rgba(251, 191, 36, 0.8); }
        .rank-card:nth-child(2) { border-color: #94a3b8; }
        .rank-card:nth-child(2) .rank-number { background: #94a3b8; color: #000; }
        .rank-card:nth-child(3) { border-color: #b45309; }
        .rank-card:nth-child(3) .rank-number { background: #b45309; color: #fff; }

        .rank-name { flex: 1; text-transform: uppercase; }
        .rank-score { color: var(--success); font-weight: 900; }

        /* Viral Code Box */
        .viral-col {
            flex: 1.2;
            background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.15));
            border: 3px solid rgba(139, 92, 246, 0.4);
            border-radius: 2.5rem;
            padding: 4rem 3rem;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            text-align: center;
            box-shadow: 0 0 60px rgba(139, 92, 246, 0.2);
            animation: pulseGlow 2s infinite alternate;
        }
        @keyframes pulseGlow {
            0% { box-shadow: 0 0 40px rgba(139, 92, 246, 0.2); }
            100% { box-shadow: 0 0 80px rgba(139, 92, 246, 0.6); }
        }
        .viral-col h3 { font-size: 3.5rem; margin-bottom: 1.5rem; color: #fff; font-weight: 900;}
        .viral-col p { font-size: 2rem; color: var(--text-light); margin-bottom: 3rem; font-weight: 600; line-height: 1.4; }
        
        .qr-container {
            background: white;
            padding: 2rem;
            border-radius: 2rem;
            margin-bottom: 2rem;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        }
        #viral-qrcode-img {
            width: 350px;
            height: 350px;
            display: block;
        }

        /* Loading Overlay */
        #loading {
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: var(--bg-dark); display: flex; align-items: center; justify-content: center;
            font-size: 3rem; z-index: 1000; font-weight: bold;
        }

        /* Live Feedback Toast Container */
        #toast-container {
            position: fixed;
            bottom: 40px;
            right: 40px;
            display: flex;
            flex-direction: column-reverse;
            gap: 20px;
            z-index: 9999;
        }

        .live-toast {
            background: var(--success);
            color: white;
            padding: 1.5rem 3rem;
            border-radius: 2rem;
            font-size: 2.5rem;
            font-weight: 900;
            box-shadow: 0 10px 40px rgba(16, 185, 129, 0.6);
            animation: slideInRight 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275), fadeOut 0.5s ease-in 2.5s forwards;
            display: flex;
            align-items: center;
            gap: 15px;
        }

        @keyframes slideInRight {
            from { transform: translateX(120%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }
    </style>
</head>
<body>

    <script src="../miniapp/supabaseConfig.js"></script>
    <div id="loading"><i class="fa-solid fa-spinner fa-spin"></i> &nbsp; Yuklanmoqda...</div>

    <div class="timer-bar" id="top-timer-bar" style="display:none;">
        <div class="timer-fill" id="timer-fill"></div>
    </div>

    <div class="top-bar">
        <div class="title" id="test-title-display">L-Lab Smart Doska</div>
        <div class="status" id="connection-status"><i class="fa-solid fa-wifi" style="color:var(--warning)"></i> Kutilyapti</div>
    </div>

    <!-- LOBBY SCREEN -->
    <div id="screen-lobby" class="screen">
        <div class="lobby-title" id="lobby-course-title">Test Nomi</div>
        <div class="lobby-subtitle"><i class="fa-solid fa-qrcode"></i> QR kodlaringizni tayyorlang! Kutilyapti...</div>
        <div class="students-grid" id="lobby-grid"></div>
    </div>

    <!-- QUESTION SCREEN -->
    <div id="screen-question" class="screen">
        <div class="question-container">
            <div class="question-text" id="question-text">Savol matni kutilyapti...</div>
            <div class="options-grid" id="options-grid"></div>
        </div>
    </div>

    <!-- LEADERBOARD SCREEN -->
    <div id="screen-leaderboard" class="screen">
        <div class="lobby-title" style="margin-bottom: 2rem; font-size: 5rem;"><i class="fa-solid fa-trophy" style="color:#fbbf24;"></i> Yakuniy Natijalar</div>
        <div class="leaderboard-container">
            <div class="rankings-col" id="rankings-list"></div>
            <div class="viral-col">
                <h3>Zo'r test ekanmi? 😍</h3>
                <p>Ushbu QR kodni skaner qiling va testni o'z botingizga nusxalab oling!</p>
                <div class="qr-container">
                    <img id="viral-qrcode-img" src="" alt="Viral QR Code">
                </div>
                <p style="font-size: 1.5rem; margin-bottom:0; color: #fff;">@SmartTester_Bot (L-Lab)</p>
            </div>
        </div>
    </div>

    <!-- LIVE TOAST FEEDBACK -->
    <div id="toast-container"></div>

    <script>
        const urlParams = new URLSearchParams(window.location.search);
        const testId = urlParams.get('test_id');
        const classId = urlParams.get('class_id');

        let testData = null;
        let questions = [];
        let students = {};
        let remoteMap = {};
        let currentQuestionIndex = -1;
        let studentScores = {};
        let studentAnswersCurrent = {};

        let questionStartTime = 0;
        let timerInterval = null;
        const totalTimeMs = 30000; 

        const screens = {
            lobby: document.getElementById('screen-lobby'),
            question: document.getElementById('screen-question'),
            leaderboard: document.getElementById('screen-leaderboard')
        };
        const loadingStr = document.getElementById('loading');

        async function init() {
            if (!testId || !classId) {
                loadingStr.innerHTML = '<span style="color:var(--danger)">Xatolik: URL da test_id yoki class_id yo\'q.</span>';
                return;
            }

            try {
                // Fetch Class/Students
                const { data: stdData, error: stdErr } = await supabaseClient
                    .from('bot_students')
                    .select('*')
                    .eq('class_id', classId)
                    .order('full_name');
                if (stdErr) throw stdErr;

                stdData.forEach(s => {
                    students[s.id] = s;
                    studentScores[s.id] = 0;
                    if (s.remote_id) {
                        remoteMap[s.remote_id] = s.id;
                    }
                });

                // Fetch Test
                const { data: tData, error: tErr } = await supabaseClient
                    .from('bot_tests')
                    .select('*')
                    .eq('id', testId)
                    .single();
                if (tErr) throw tErr;
                testData = tData;
                document.getElementById('test-title-display').innerText = tData.title;
                document.getElementById('lobby-course-title').innerText = tData.title;

                // Fetch Questions
                const { data: qData, error: qErr } = await supabaseClient
                    .from('bot_questions')
                    .select('*')
                    .eq('test_id', testId)
                    .order('id');
                if (qErr) throw qErr;

                // Fetch Options
                const qIds = qData.map(q => q.id);
                const { data: optData, error: optErr } = await supabaseClient
                    .from('bot_options')
                    .select('*')
                    .in('question_id', qIds);
                if (optErr) throw optErr;

                questions = qData.map(q => {
                    return {
                        ...q,
                        options: optData.filter(o => o.question_id === q.id).sort((a, b) => a.id - b.id)
                    };
                });

                // Setup Viral QR Code dynamically using stable Image API
                const botUsername = "roziyevbehroz_bot"; 
                const inviteLink = `https://t.me/${botUsername}?start=share_test_${testId}`;
                document.getElementById('viral-qrcode-img').src = `https://api.qrserver.com/v1/create-qr-code/?size=350x350&margin=2&data=${encodeURIComponent(inviteLink)}`;

                renderLobby();
                showScreen('lobby');
                loadingStr.style.display = 'none';
                setupRealtime();

            } catch (err) {
                console.error(err);
                loadingStr.innerHTML = `<span style="color:var(--danger)">Xatolik: ${err.message}</span>`;
            }
        }

        function setupRealtime() {
            const channelName = `session-${testId}-${classId}`;
            const channel = supabaseClient.channel(channelName);

            channel.on('broadcast', { event: 'control' }, (payload) => {
                const action = payload.payload.action;
                const data = payload.payload.data;
                console.log("Teacher action:", action, data);

                if (action === 'start' || action === 'next') {
                    currentQuestionIndex = data; // index defaults to 0 from app.js
                    renderQuestion();
                } else if (action === 'finish') {
                    showLeaderboard();
                }
            });

            channel.on('broadcast', { event: 'remote_signal' }, (payload) => {
                const { remote_id, student_id, answer, is_correct } = payload.payload;
                handleRemoteSignal(remote_id, student_id, answer, is_correct);
            });

            channel.subscribe((status) => {
                const badge = document.getElementById('connection-status');
                if (status === 'SUBSCRIBED') {
                    badge.innerHTML = '<i class="fa-solid fa-wifi" style="color:var(--success)"></i> Sinxronizatsiya: Faol';
                } else {
                    badge.innerHTML = '<i class="fa-solid fa-wifi" style="color:var(--warning)"></i> Uzildi... Qidirilmoqda...';
                }
            });
        }

        function handleRemoteSignal(remote_id, override_student_id, answer, is_correct) {
            let studentId = override_student_id;
            if (!studentId && remote_id) studentId = remoteMap[remote_id];
            if (!studentId || !students[studentId]) return; 

            const st = students[studentId];

            if (screens.lobby.classList.contains('active')) {
                const card = document.getElementById('lobby-card-' + studentId);
                if (card && !card.classList.contains('joined')) {
                    card.classList.add('joined');
                    card.innerHTML += ' <i class="fa-solid fa-check-circle" style="color:var(--success)"></i>';
                }
                return;
            }

            if (screens.question.classList.contains('active')) {
                if (studentAnswersCurrent[studentId]) return;
                studentAnswersCurrent[studentId] = true;

                showToastFeedback(st.full_name, st.remote_id || "?");

                if (is_correct) {
                    const timeElapsed = Date.now() - questionStartTime;
                    let points = Math.max(10, 1000 - Math.floor((timeElapsed / totalTimeMs) * 1000));
                    studentScores[studentId] += points;
                }
            }
        }

        function showToastFeedback(name, remoteId) {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = 'live-toast';
            
            // Format name short (like "Vali" instead of full name)
            const shortName = name.split(' ')[0];
            toast.innerHTML = `<i class="fa-solid fa-check-circle"></i> #${remoteId} ${shortName}`;
            
            container.appendChild(toast);
            setTimeout(() => {
                if(toast.parentElement) toast.remove();
            }, 3000);
        }

        function showScreen(name) {
            Object.values(screens).forEach(s => s.classList.remove('active'));
            screens[name].classList.add('active');

            const topTimer = document.getElementById('top-timer-bar');
            if (name !== 'question') {
                clearInterval(timerInterval);
                topTimer.style.display = 'none';
            } else {
                topTimer.style.display = 'block';
            }
        }

        function renderLobby() {
            const grid = document.getElementById('lobby-grid');
            let html = '';
            Object.values(students).forEach(st => {
                html += `<div class="student-card" id="lobby-card-${st.id}">
                    <span style="opacity:0.5; font-size:1.5rem;">#${st.remote_id || '?'}</span> 
                    &nbsp; ${st.full_name}
                </div>`;
            });
            grid.innerHTML = html;
        }

        function renderQuestion() {
            showScreen('question');
            studentAnswersCurrent = {}; 
            
            if (currentQuestionIndex < 0 || currentQuestionIndex >= questions.length) return;
            const q = questions[currentQuestionIndex];

            document.getElementById('question-text').innerText = `${currentQuestionIndex + 1}. ${q.text}`;

            let optsHtml = '';
            const labels = ['A', 'B', 'C', 'D'];
            q.options.forEach((opt, idx) => {
                optsHtml += `
                    <div class="option-btn opt-${idx}">
                        <div class="badge">${labels[idx]}</div>
                        ${opt.text}
                    </div>
                `;
            });
            document.getElementById('options-grid').innerHTML = optsHtml;

            // Timer Bar Animation
            questionStartTime = Date.now();
            const fill = document.getElementById('timer-fill');
            fill.style.transform = 'scaleX(1)';
            fill.style.transition = 'none';

            setTimeout(() => {
                fill.style.transition = `transform ${totalTimeMs}ms linear`;
                fill.style.transform = 'scaleX(0)';
            }, 50);

            clearInterval(timerInterval);
            timerInterval = setTimeout(() => {
                fill.style.transform = 'scaleX(0)';
            }, totalTimeMs);
        }

        function showLeaderboard() {
            showScreen('leaderboard');
            
            const sorted = Object.values(students).sort((a, b) => studentScores[b.id] - studentScores[a.id]);

            let html = '';
            sorted.slice(0, 5).forEach((st, idx) => {
                if (studentScores[st.id] === 0 && idx > 2) return; 

                html += `
                    <div class="rank-card">
                        <div class="rank-number">${idx + 1}</div>
                        <div class="rank-name">${st.full_name}</div>
                        <div class="rank-score">${studentScores[st.id]} ball</div>
                    </div>
                `;
            });
            document.getElementById('rankings-list').innerHTML = html;

            confetti({ particleCount: 200, spread: 120, origin: { y: 0.5 } });
            setTimeout(() => { confetti({ particleCount: 100, spread: 100, angle: 60, origin: { x: 0 } }); }, 500);
            setTimeout(() => { confetti({ particleCount: 100, spread: 100, angle: 120, origin: { x: 1 } }); }, 1000);
        }

        window.addEventListener('DOMContentLoaded', init);
    </script>
</body>
</html>
"""
with open(r"e:\LLabbot\scanner\display.html", "w", encoding="utf-8") as f:
    f.write(html_content)

print("Display updated!")
