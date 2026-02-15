// ==========================================
// LLAB QR SCANNER — v9 SLAVE MODE
// Phone = Camera + Marker Detection
// Whiteboard (display) = Master Controller
// PeerJS WebRTC P2P Sync
// ==========================================

(function () {
    'use strict';

    // ─── DEBUG ───
    var debugEl = document.getElementById('debugConsole');
    var debugVisible = false;
    function dbg(msg) {
        console.log('[SCAN]', msg);
        if (!debugEl) return;
        if (debugVisible) {
            debugEl.style.display = 'block';
            debugEl.textContent = msg + '\n' + (debugEl.textContent || '').slice(0, 600);
        }
    }

    // 5-tap debug toggle
    var tapCount = 0, tapTimer = null;
    document.addEventListener('click', function () {
        tapCount++;
        clearTimeout(tapTimer);
        tapTimer = setTimeout(function () { tapCount = 0; }, 500);
        if (tapCount >= 5) {
            tapCount = 0;
            // Toggle debug
        }
    });

    // BLOCKING OVERLAY
    var overlay = document.createElement('div');
    overlay.id = 'connectOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.9);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;text-align:center;padding:20px;';
    overlay.innerHTML = '<div style="font-size:40px;margin-bottom:20px;">🛰️</div><h2 style="margin:0 0 10px 0;">Display qidirilmoqda...</h2><p style="color:#aaa;font-size:14px;margin:0;">Iltimos, kuting. Telefonda internet borligini tekshiring.</p><div style="margin-top:20px;font-size:12px;color:#666;" id="connStep">Step 1: Init Peer</div>';
    document.body.appendChild(overlay);

    function updateOverlay(msg) {
        var el = document.getElementById('connStep');
        if (el) el.textContent = msg;
    }

    function hideOverlay() {
        overlay.style.display = 'none';
    }

    function showOverlay(msg) {
        overlay.style.display = 'flex';
        updateOverlay(msg || 'Reconnecting...');
    }

    // ─── TELEGRAM WEBAPP ───
    var tg = null;
    try {
        tg = window.Telegram && window.Telegram.WebApp;
        if (tg) { tg.expand(); tg.ready(); }
    } catch (e) { }

    // ─── CHECK LIBRARIES ───
    if (typeof CV === 'undefined') { dbg('ERROR: CV!'); return; }
    if (typeof AR === 'undefined') { dbg('ERROR: AR!'); return; }

    // ─── CONSTANTS ───
    var VOTE_THRESHOLD = 8;
    var MIN_EDGE = 15;
    var LETTERS = ['A', 'B', 'C', 'D'];

    // ─── STATE ───
    var testData = null;
    var currentQuestion = 0;
    var allResults = {};         // {qIdx: {mid: {answer, isCorrect, name}}}
    var currentScanResults = {}; // current question results
    var voteBuffers = {};
    var lockedAnswers = {};
    var running = false;
    var cameraStream = null;
    var sessionId = null;
    var synced = false;          // true when connected to display

    // ─── PEERJS ───
    var syncPeer = null;
    var displayConn = null;
    var reconnectTimer = null;
    var reconnectAttempts = 0;
    var MAX_RECONNECT = 50;

    function syncSend(data) {
        if (displayConn && displayConn.open) {
            try { displayConn.send(data); } catch (e) { }
        }
    }

    function initSync() {
        if (!sessionId) {
            dbg('No session ID');
            updateSyncUI('off');
            return;
        }
        if (typeof Peer === 'undefined') {
            dbg('PeerJS not loaded');
            updateSyncUI('off');
            return;
        }

        var scannerId = sessionId + '-scanner';
        var displayId = sessionId + '-display';
        dbg('Sync: creating peer ' + scannerId);

        try {
            syncPeer = new Peer(scannerId, {
                debug: 3,
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.l.google.com:19302' },
                        { urls: 'stun:stun3.l.google.com:19302' },
                        { urls: 'stun:stun4.l.google.com:19302' },
                        { urls: 'stun:global.stun.twilio.com:3478' }
                    ]
                }
            });
        } catch (e) {
            dbg('Peer err: ' + e.message);
            updateSyncUI('off');
            return;
        }

        syncPeer.on('open', function (id) {
            dbg('Sync: peer open ' + id);
            updateSyncUI('connecting');
            connectToDisplay(displayId);
        });

        syncPeer.on('error', function (err) {
            dbg('Sync err: ' + err.type);
            if (err.type === 'peer-unavailable') {
                // Display not ready — retry
                updateSyncUI('waiting');
                scheduleReconnect(displayId);
            } else if (err.type === 'unavailable-id') {
                // Our ID taken — recreate
                syncPeer.destroy();
                scannerId = sessionId + '-scanner-' + Date.now() % 10000;
                setTimeout(initSync, 1500);
            }
        });

        syncPeer.on('disconnected', function () {
            updateSyncUI('connecting');
            try { syncPeer.reconnect(); } catch (e) { }
        });
    }

    function connectToDisplay(displayId) {
        // Remove limit - retry forever
        // if (reconnectAttempts >= MAX_RECONNECT) { ... }

        dbg('Connecting to ' + displayId + ' (attempt ' + (reconnectAttempts + 1) + ')');
        updateOverlay('Step 2: Connecting to Display... (' + (reconnectAttempts + 1) + ')');

        if (displayConn) { try { displayConn.close(); } catch (e) { } }

        try {
            // RELIABLE: FALSE for mobile speed/compatibility
            displayConn = syncPeer.connect(displayId, { reliable: false });
        } catch (e) {
            dbg('Connect err: ' + e.message);
            scheduleReconnect(displayId);
            return;
        }

        displayConn.on('open', function () {
            synced = true;
            reconnectAttempts = 0;
            dbg('CONNECTED to display!');
            updateSyncUI('connected');
            hideOverlay(); // UNBLOCK UI
            applySyncMode();

            // Tell display we're here
            syncSend({
                type: 'scanner-ready',
                currentQuestion: currentQuestion
            });
        });

        displayConn.on('data', function (msg) {
            handleDisplayCommand(msg);
        });

        displayConn.on('close', function () {
            synced = false;
            dbg('Display disconnected');
            updateSyncUI('connecting');
            showOverlay('Connection lost. Reconnecting...'); // BLOCK UI
            removeSyncMode();
            scheduleReconnect(displayId);
        });

        displayConn.on('error', function (err) {
            dbg('Conn err: ' + err);
            synced = false;
            updateSyncUI('connecting');
        });
    }

    function scheduleReconnect(displayId) {
        clearTimeout(reconnectTimer);
        reconnectAttempts++;
        var delay = Math.min(3000 + reconnectAttempts * 500, 10000);
        reconnectTimer = setTimeout(function () {
            connectToDisplay(displayId);
        }, delay);
    }

    // ════════════════════════════════════════
    // RECEIVE COMMANDS FROM WHITEBOARD
    // ════════════════════════════════════════
    function handleDisplayCommand(msg) {
        dbg('CMD: ' + msg.type);

        switch (msg.type) {
            case 'goto':
                // Whiteboard says: go to question X
                showQuestion(msg.q);
                break;

            case 'finish':
                // Whiteboard says: test is done
                allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
                running = false;
                if (cameraStream) cameraStream.getTracks().forEach(function (t) { t.stop(); });
                showLeaderboard(msg.allResults || allResults);
                break;

            case 'sendResults':
                // Whiteboard says: send results to Telegram bot
                sendResults();
                break;

            case 'ping':
                syncSend({ type: 'pong' });
                break;
        }
    }

    // ════════════════════════════════════════
    // SYNC UI — disable navigation when synced
    // ════════════════════════════════════════
    function applySyncMode() {
        // Disable nav buttons — whiteboard controls
        var nextBtn = $('next-question-btn');
        var prevBtn = $('prev-question-btn');
        var finishBtn = $('finish-test-btn');

        if (nextBtn) { nextBtn.disabled = true; nextBtn.textContent = '📡 Display boshqaradi'; }
        if (prevBtn) { prevBtn.disabled = true; }
        if (finishBtn) { finishBtn.disabled = true; finishBtn.textContent = '📡 Display boshqaradi'; }
    }

    function removeSyncMode() {
        var nextBtn = $('next-question-btn');
        var prevBtn = $('prev-question-btn');
        var finishBtn = $('finish-test-btn');

        if (nextBtn) { nextBtn.disabled = false; nextBtn.textContent = 'Keyingi ➡️'; }
        if (prevBtn) { prevBtn.disabled = false; }
        if (finishBtn) { finishBtn.disabled = false; finishBtn.textContent = '🏁 Tugatish'; }
    }

    function updateSyncUI(status) {
        var el = $('syncStatus');
        if (!el) return;
        switch (status) {
            case 'connected':
                el.innerHTML = '<span style="color:#22c55e">🟢 Display ulangan</span>';
                el.style.background = 'rgba(34,197,94,0.1)';
                break;
            case 'connecting':
                el.innerHTML = '<span style="color:#f59e0b">🟡 Ulanmoqda...</span>';
                el.style.background = 'rgba(245,158,11,0.1)';
                break;
            case 'waiting':
                el.innerHTML = '<span style="color:#94a3b8">⏳ Display kutilmoqda...</span>';
                el.style.background = 'rgba(148,163,184,0.1)';
                break;
            default:
                el.innerHTML = '<span style="color:#64748b">⚪ Sinxron o\'chiq</span>';
                el.style.background = 'transparent';
        }
    }

    // ─── DOM ───
    function $(id) { return document.getElementById(id); }
    var sessionScreen = $('sessionScreen');
    var scannerScreen = $('scannerScreen');
    var leaderboardScreen = $('leaderboardScreen');
    var videoEl = $('videoInput');
    var canvasEl = $('canvasOutput');
    var loadingMsg = $('loadingMessage');
    var cameraSelect = $('cameraSelect');

    // ════════════════════════════════════════
    // DATA LOADING
    // ════════════════════════════════════════
    function loadTestData() {
        try {
            var params = new URLSearchParams(window.location.search);
            var encoded = params.get('data');
            sessionId = params.get('session');
            if (encoded) {
                testData = JSON.parse(atob(encoded));
                dbg('Loaded: ' + testData.title + ' Q=' + testData.questions.length);
            }
        } catch (e) { dbg('Parse err: ' + e.message); }

        if (!testData) {
            testData = {
                test_id: 0, title: "Demo Test", class_name: "Demo",
                students: [
                    { id: 0, name: "Ali" }, { id: 1, name: "Vali" },
                    { id: 2, name: "Sardor" }, { id: 3, name: "Jasur" },
                    { id: 4, name: "Dilshod" }
                ],
                questions: [
                    { text: "O'zbekiston poytaxti?", options: ["Samarqand", "Toshkent", "Buxoro", "Andijon"], correct: 1 },
                    { text: "Nechta viloyat bor?", options: ["14", "12", "13", "15"], correct: 2 }
                ]
            };
            if (!sessionId) sessionId = 'llab-demo-' + Date.now() % 100000;
        }

        $('sessionTitle').textContent = testData.title;
        $('sessionClass').textContent = testData.class_name || '—';
        $('sessionCount').textContent = testData.questions.length + ' ta';
        $('sessionStudents').textContent = testData.students.length > 0
            ? testData.students.length + ' ta' : 'Sinf tanlanmagan';
    }

    // ════════════════════════════════════════
    // STUDENT MAPPING
    // ════════════════════════════════════════
    function studentName(markerId) {
        if (testData.students.length > 0) {
            for (var i = 0; i < testData.students.length; i++) {
                if (testData.students[i].id === markerId) return testData.students[i].name;
            }
        }
        return 'P' + (markerId + 1);
    }

    // ════════════════════════════════════════
    // ANSWER DETECTION — Plickers corner[0]
    // ════════════════════════════════════════
    function detectAnswer(corners) {
        var cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
        var cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;
        var angle = Math.atan2(corners[0].y - cy, corners[0].x - cx) * (180 / Math.PI);
        if (angle >= -157.5 && angle < -67.5) return 0;
        if (angle >= -67.5 && angle < 22.5) return 1;
        if (angle >= 22.5 && angle < 112.5) return 2;
        return 3;
    }

    function avgEdge(c) {
        var sum = 0;
        for (var i = 0; i < 4; i++) {
            var j = (i + 1) % 4;
            var dx = c[i].x - c[j].x, dy = c[i].y - c[j].y;
            sum += Math.sqrt(dx * dx + dy * dy);
        }
        return sum / 4;
    }

    // ════════════════════════════════════════
    // SHOW QUESTION
    // ════════════════════════════════════════
    function showQuestion(idx) {
        if (idx < 0 || idx >= testData.questions.length) return;

        // Save current results
        if (Object.keys(currentScanResults).length > 0) {
            allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        }

        currentQuestion = idx;
        currentScanResults = allResults[idx] ? JSON.parse(JSON.stringify(allResults[idx])) : {};
        voteBuffers = {};
        lockedAnswers = {};

        // Restore locked from saved
        for (var mid in currentScanResults) {
            if (currentScanResults.hasOwnProperty(mid)) {
                lockedAnswers[mid] = currentScanResults[mid].answer;
            }
        }

        var q = testData.questions[idx];
        $('current-q').textContent = idx + 1;
        $('total-q').textContent = testData.questions.length;
        $('questionText').textContent = (idx + 1) + '. ' + q.text;
        $('correctLetter').textContent = LETTERS[q.correct];
        $('scannerTitle').textContent = testData.title;

        if (!synced) {
            $('prev-question-btn').disabled = (idx === 0);
            $('next-question-btn').textContent = (idx === testData.questions.length - 1) ? '🏁 Tugatish' : 'Keyingi ➡️';
        }

        refreshUI();
    }

    // ════════════════════════════════════════
    // UI REFRESH
    // ════════════════════════════════════════
    function refreshUI() {
        var entries = [];
        for (var key in currentScanResults) {
            if (currentScanResults.hasOwnProperty(key)) entries.push(currentScanResults[key]);
        }
        var correct = 0, wrong = 0;
        for (var i = 0; i < entries.length; i++) {
            if (entries[i].isCorrect) correct++; else wrong++;
        }
        $('correct-count').textContent = correct;
        $('wrong-count').textContent = wrong;
        $('total-scanned').textContent = entries.length;

        var list = $('results-list');
        list.innerHTML = '';
        for (var j = 0; j < entries.length; j++) {
            var r = entries[j];
            var li = document.createElement('li');
            li.className = 'result-item ' + (r.isCorrect ? 'correct' : 'wrong');
            li.innerHTML = '<span>' + r.name + '</span> <strong>' + r.answer + '</strong> ' + (r.isCorrect ? '✅' : '❌');
            list.appendChild(li);
        }
    }

    // ════════════════════════════════════════
    // DRAW OVERLAY
    // ════════════════════════════════════════
    function drawOverlay(ctx, corners, name, text, isCorrect, locked) {
        var color = locked ? (isCorrect ? '#00ff44' : '#ff3344') : '#ffaa00';
        ctx.strokeStyle = color;
        ctx.lineWidth = locked ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (var i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = locked
            ? (isCorrect ? 'rgba(0,255,68,0.15)' : 'rgba(255,51,68,0.15)')
            : 'rgba(255,170,0,0.08)';
        ctx.fill();

        ctx.fillStyle = color;
        for (var k = 0; k < 4; k++) {
            ctx.beginPath();
            ctx.arc(corners[k].x, corners[k].y, k === 0 ? 5 : 3, 0, Math.PI * 2);
            ctx.fill();
        }

        var label = name + ': ' + text;
        if (locked) label += isCorrect ? ' ✓' : ' ✗';
        var minX = corners[0].x, minY = corners[0].y;
        for (var p = 1; p < 4; p++) {
            if (corners[p].x < minX) minX = corners[p].x;
            if (corners[p].y < minY) minY = corners[p].y;
        }
        ctx.font = 'bold 14px sans-serif';
        var tw = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(minX - 2, minY - 22, tw + 8, 20);
        ctx.fillStyle = '#000';
        ctx.fillText(label, minX + 2, minY - 7);
    }

    // ════════════════════════════════════════
    // CAMERA & DETECTION
    // ════════════════════════════════════════
    async function startScanner() {
        dbg('Starting camera...');
        var ctx = canvasEl.getContext('2d');
        var detector;
        try { detector = new AR.Detector(); } catch (e) { dbg('Detector err'); return; }

        try {
            var tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
            tempStream.getTracks().forEach(function (t) { t.stop(); });
            var devices = await navigator.mediaDevices.enumerateDevices();
            var cams = devices.filter(function (d) { return d.kind === 'videoinput'; });

            cameraSelect.innerHTML = '';
            for (var ci = 0; ci < cams.length; ci++) {
                var opt = document.createElement('option');
                opt.value = cams[ci].deviceId;
                opt.textContent = cams[ci].label || ('camera ' + ci);
                cameraSelect.appendChild(opt);
            }
            for (var bi = 0; bi < cams.length; bi++) {
                if (/back|rear|environment/i.test(cams[bi].label)) {
                    cameraSelect.value = cams[bi].deviceId;
                    break;
                }
            }
        } catch (e) {
            dbg('Cam err: ' + e.message);
            if (loadingMsg) loadingMsg.textContent = '⚠️ Kamera ruxsati berilmadi!';
            return;
        }

        async function openCamera(deviceId) {
            if (cameraStream) cameraStream.getTracks().forEach(function (t) { t.stop(); });
            var constraints = {
                audio: false,
                video: deviceId
                    ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
                    : { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
            };
            try {
                cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (e) {
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
            }
            videoEl.srcObject = cameraStream;
            await videoEl.play();
            if (loadingMsg) loadingMsg.style.display = 'none';
        }

        cameraSelect.onchange = function () { openCamera(cameraSelect.value); };
        $('switchCameraBtn').onclick = function () {
            var opts = cameraSelect.options;
            cameraSelect.selectedIndex = (cameraSelect.selectedIndex + 1) % opts.length;
            openCamera(cameraSelect.value);
        };

        await openCamera(cameraSelect.value || null);

        // Detection loop
        running = true;
        var frameNum = 0, lastLog = 0;

        function tick() {
            if (!running) return;
            try {
                if (videoEl.readyState >= videoEl.HAVE_ENOUGH_DATA) {
                    var w = videoEl.videoWidth, h = videoEl.videoHeight;
                    if (w > 0 && h > 0) {
                        canvasEl.width = w;
                        canvasEl.height = h;
                        ctx.drawImage(videoEl, 0, 0, w, h);
                        var imageData = ctx.getImageData(0, 0, w, h);
                        var markers = detector.detect(imageData);
                        frameNum++;
                        if (markers.length > 0 && frameNum - lastLog > 30) {
                            lastLog = frameNum;
                            var ids = [];
                            for (var mi = 0; mi < markers.length; mi++) ids.push(markers[mi].id);
                            dbg('F' + frameNum + ': [' + ids.join(',') + ']');
                        }
                        processMarkers(ctx, markers);
                    }
                }
            } catch (e) { dbg('Tick: ' + e.message); }
            requestAnimationFrame(tick);
        }
        tick();
    }

    // ════════════════════════════════════════
    // PROCESS MARKERS + SYNC TO DISPLAY
    // ════════════════════════════════════════
    function processMarkers(ctx, markers) {
        if (markers.length === 0) return;
        var q = testData.questions[currentQuestion];
        if (!q) return;
        var correctIdx = q.correct;
        var seen = {};

        for (var i = 0; i < markers.length; i++) {
            var m = markers[i];
            var mid = m.id;
            if (seen[mid]) continue;
            seen[mid] = true;
            var edge = avgEdge(m.corners);
            if (edge < MIN_EDGE) continue;
            var name = studentName(mid);

            if (lockedAnswers[mid] !== undefined) {
                var lockAns = lockedAnswers[mid];
                var lockOk = (LETTERS.indexOf(lockAns) === correctIdx);
                drawOverlay(ctx, m.corners, name, lockAns, lockOk, true);
                continue;
            }

            var ansIdx = detectAnswer(m.corners);
            var ans = LETTERS[ansIdx];

            if (!voteBuffers[mid]) voteBuffers[mid] = { answer: ans, count: 0 };
            if (voteBuffers[mid].answer === ans) {
                voteBuffers[mid].count++;
            } else {
                voteBuffers[mid] = { answer: ans, count: 1 };
            }

            var pct = Math.min(100, Math.round((voteBuffers[mid].count / VOTE_THRESHOLD) * 100));

            if (voteBuffers[mid].count >= VOTE_THRESHOLD) {
                // LOCK
                lockedAnswers[mid] = ans;
                var isOk = (ansIdx === correctIdx);
                currentScanResults[mid] = { answer: ans, isCorrect: isOk, name: name };
                refreshUI();
                drawOverlay(ctx, m.corners, name, ans, isOk, true);
                dbg('✓ ' + name + ' → ' + ans + (isOk ? ' ✓' : ' ✗'));

                // SYNC: send lock to display
                syncSend({
                    type: 'lock',
                    mid: mid,
                    answer: ans,
                    isCorrect: isOk,
                    name: name,
                    q: currentQuestion
                });

                try {
                    if (tg && tg.HapticFeedback) {
                        tg.HapticFeedback.notificationOccurred(isOk ? 'success' : 'error');
                    }
                } catch (e) { }
            } else {
                drawOverlay(ctx, m.corners, name, ans + ' ' + pct + '%', null, false);

                // SYNC: send scan progress (throttled)
                if (pct % 25 === 0 && pct > 0) {
                    syncSend({
                        type: 'scan',
                        mid: mid,
                        answer: ans,
                        name: name,
                        pct: pct,
                        q: currentQuestion
                    });
                }
            }
        }
    }

    // ════════════════════════════════════════
    // LEADERBOARD
    // ════════════════════════════════════════
    function showLeaderboard(results) {
        var finalResults = results || allResults;
        scannerScreen.classList.add('scanner-hidden');
        leaderboardScreen.classList.remove('scanner-hidden');

        var scores = {};
        for (var qIdx in finalResults) {
            if (!finalResults.hasOwnProperty(qIdx)) continue;
            for (var mid in finalResults[qIdx]) {
                if (!finalResults[qIdx].hasOwnProperty(mid)) continue;
                var r = finalResults[qIdx][mid];
                if (!scores[mid]) scores[mid] = { name: r.name, correct: 0, total: 0 };
                scores[mid].total++;
                if (r.isCorrect) scores[mid].correct++;
            }
        }

        var sorted = [];
        for (var sid in scores) { if (scores.hasOwnProperty(sid)) sorted.push(scores[sid]); }
        sorted.sort(function (a, b) { return b.correct - a.correct; });

        var medals = ['🥇', '🥈', '🥉'];
        var totalQ = testData.questions.length;
        var list = $('lbList');
        list.innerHTML = '';
        for (var i = 0; i < sorted.length; i++) {
            var s = sorted[i];
            var p = totalQ > 0 ? Math.round((s.correct / totalQ) * 100) : 0;
            var row = document.createElement('div');
            row.className = 'lb-row';
            row.innerHTML =
                '<div class="lb-rank">' + (i < 3 ? medals[i] : (i + 1)) + '</div>' +
                '<div class="lb-name">' + s.name + '</div>' +
                '<div class="lb-score">' + s.correct + '/' + totalQ + ' (' + p + '%)</div>';
            list.appendChild(row);
        }

        if (sorted.length === 0) {
            list.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:20px;">Natijalar topilmadi</div>';
        }
    }

    // ════════════════════════════════════════
    // SEND RESULTS TO BOT
    // ════════════════════════════════════════
    function sendResults() {
        var statusEl = $('sendStatus');
        try {
            allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
            var data = {
                a: 'llab_qr_results',
                t: testData.test_id,
                n: testData.title,
                q: testData.questions.length,
                c: {}, r: {}, s: {}
            };
            for (var qi = 0; qi < testData.questions.length; qi++) {
                data.c[qi] = testData.questions[qi].correct;
            }
            for (var qIdx in allResults) {
                if (!allResults.hasOwnProperty(qIdx)) continue;
                data.r[qIdx] = {};
                for (var mid in allResults[qIdx]) {
                    if (!allResults[qIdx].hasOwnProperty(mid)) continue;
                    var r = allResults[qIdx][mid];
                    data.r[qIdx][mid] = LETTERS.indexOf(r.answer);
                    if (!data.s[mid]) data.s[mid] = r.name;
                }
            }
            var payload = JSON.stringify(data);

            // Compress if too large
            if (payload.length > 4000) {
                var mini = { a: 'llab_qr_results', t: data.t, n: data.n, q: data.q, scores: {} };
                for (var mqi in allResults) {
                    if (!allResults.hasOwnProperty(mqi)) continue;
                    for (var mmid in allResults[mqi]) {
                        if (!allResults[mqi].hasOwnProperty(mmid)) continue;
                        var mr = allResults[mqi][mmid];
                        if (!mini.scores[mmid]) mini.scores[mmid] = { n: mr.name, c: 0, t: 0 };
                        mini.scores[mmid].t++;
                        if (mr.isCorrect) mini.scores[mmid].c++;
                    }
                }
                payload = JSON.stringify(mini);
            }

            if (tg && tg.sendData) {
                tg.sendData(payload);
                if (statusEl) { statusEl.textContent = '✅ Yuborildi!'; statusEl.style.color = '#22c55e'; }
                setTimeout(function () { try { tg.close(); } catch (e) { } }, 2000);
            } else {
                if (statusEl) { statusEl.textContent = '⚠️ TG topilmadi'; statusEl.style.color = '#ffaa00'; }
                dbg('sendData: no TG');
            }
        } catch (e) {
            if (statusEl) { statusEl.textContent = '❌ ' + e.message; statusEl.style.color = '#ff3344'; }
        }
    }

    // ════════════════════════════════════════
    // EVENT HANDLERS
    // ════════════════════════════════════════
    $('startScannerBtn').onclick = function () {
        sessionScreen.classList.add('scanner-hidden');
        scannerScreen.classList.remove('scanner-hidden');
        showQuestion(0);
        startScanner();
        initSync();
    };

    $('next-question-btn').onclick = function () {
        if (synced) return; // Display controls when synced
        allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        if (currentQuestion >= testData.questions.length - 1) {
            showLeaderboard();
        } else {
            showQuestion(currentQuestion + 1);
        }
    };

    $('prev-question-btn').onclick = function () {
        if (synced) return;
        allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        if (currentQuestion > 0) showQuestion(currentQuestion - 1);
    };

    $('finish-test-btn').onclick = function () {
        if (synced) return;
        allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        showLeaderboard();
    };

    $('sendResultsBtn').onclick = sendResults;

    // ════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════
    dbg('v9 SLAVE init');
    loadTestData();

})();
