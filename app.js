// ==========================================
// SCANNER APP v6 — COMPLETE REWRITE
// IIFE pattern — no DOMContentLoaded dependency
// Built-in debug overlay for diagnostics
// Maximum error resilience
// ==========================================

(function () {
    'use strict';

    // ─── DEBUG OVERLAY ───
    // Shows diagnostic info directly on screen
    const debugEl = document.getElementById('debugConsole');
    function dbg(msg) {
        console.log('[SCAN]', msg);
        if (debugEl) {
            debugEl.style.display = 'block';
            debugEl.textContent = msg + '\n' + (debugEl.textContent || '').slice(0, 500);
        }
    }

    // ─── TELEGRAM WEBAPP ───
    let tg = null;
    try {
        tg = window.Telegram && window.Telegram.WebApp;
        if (tg) { tg.expand(); tg.ready(); }
        dbg('TG: ' + (tg ? 'ok' : 'null'));
    } catch (e) {
        dbg('TG init error: ' + e.message);
    }

    // ─── CHECK LIBRARIES ───
    if (typeof CV === 'undefined') { dbg('ERROR: CV not loaded!'); return; }
    if (typeof AR === 'undefined') { dbg('ERROR: AR not loaded!'); return; }
    dbg('CV+AR loaded OK');

    // ─── STATE ───
    let testData = null;
    let currentQuestion = 0;
    let allResults = {};       // {qIdx: {markerIdx: {answer, isCorrect, name}}}
    let currentScanResults = {};
    let voteBuffers = {};      // {markerIdx: {answer, count}}
    let lockedAnswers = {};    // {markerIdx: letter}
    let running = false;
    let cameraStream = null;

    // ─── SETTINGS ───
    const VOTE_THRESHOLD = 10;
    const MIN_EDGE = 25;
    const LETTERS = ['A', 'B', 'C', 'D'];

    // ─── DOM ELEMENTS ───
    const $ = id => document.getElementById(id);
    const sessionScreen = $('sessionScreen');
    const scannerScreen = $('scannerScreen');
    const leaderboardScreen = $('leaderboardScreen');
    const videoEl = $('videoInput');
    const canvasEl = $('canvasOutput');
    const loadingMsg = $('loadingMessage');
    const cameraSelect = $('cameraSelect');

    // ════════════════════════════════════════
    // LOAD & PARSE TEST DATA
    // ════════════════════════════════════════
    function loadTestData() {
        try {
            const params = new URLSearchParams(window.location.search);
            const encoded = params.get('data');
            if (encoded) {
                testData = JSON.parse(atob(encoded));
                dbg('Data loaded: ' + testData.title + ', Q=' + testData.questions.length + ', S=' + testData.students.length);
            }
        } catch (e) {
            dbg('Data parse error: ' + e.message);
        }

        if (!testData) {
            testData = {
                test_id: 0, title: "Demo Test", class_name: "Namuna",
                students: [
                    { id: 1, name: "Ali" }, { id: 2, name: "Vali" },
                    { id: 3, name: "Sardor" }, { id: 4, name: "Jasur" },
                    { id: 5, name: "Dilshod" }
                ],
                questions: [
                    { text: "Poytaxt?", options: ["Samarqand", "Toshkent", "Buxoro", "Namangan"], correct: 1 },
                    { text: "Viloyatlar?", options: ["14", "12", "13", "15"], correct: 2 }
                ]
            };
            dbg('Using DEMO data');
        }

        $('sessionTitle').textContent = testData.title;
        $('sessionClass').textContent = testData.class_name || '—';
        $('sessionCount').textContent = testData.questions.length + ' ta';
        $('sessionStudents').textContent = testData.students.length + ' ta';
    }

    // ════════════════════════════════════════
    // STUDENT MAPPING: Marker index → Student
    // Marker #0 = students[0], Marker #1 = students[1], etc.
    // ════════════════════════════════════════
    function studentName(markerIdx) {
        if (markerIdx >= 0 && markerIdx < testData.students.length) {
            return testData.students[markerIdx].name;
        }
        return '#' + (markerIdx + 1);
    }

    function isValidStudent(markerIdx) {
        return markerIdx >= 0 && markerIdx < testData.students.length;
    }

    // ════════════════════════════════════════
    // GEOMETRY HELPERS
    // ════════════════════════════════════════
    function avgEdgeLen(corners) {
        let sum = 0;
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            const dx = corners[i].x - corners[j].x;
            const dy = corners[i].y - corners[j].y;
            sum += Math.sqrt(dx * dx + dy * dy);
        }
        return sum / 4;
    }

    // Determine which edge is on TOP → that's the answer
    // Edge 0 (corner0→corner1) = A
    // Edge 1 (corner1→corner2) = B
    // Edge 2 (corner2→corner3) = C
    // Edge 3 (corner3→corner0) = D
    function detectAnswer(corners) {
        let topEdge = 0;
        let minMidY = Infinity;
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            const midY = (corners[i].y + corners[j].y) / 2;
            if (midY < minMidY) {
                minMidY = midY;
                topEdge = i;
            }
        }
        return topEdge; // 0=A, 1=B, 2=C, 3=D
    }

    // ════════════════════════════════════════
    // SHOW QUESTION
    // ════════════════════════════════════════
    function showQuestion(idx) {
        if (idx < 0 || idx >= testData.questions.length) return;

        // Save previous
        if (Object.keys(currentScanResults).length > 0) {
            allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        }

        currentQuestion = idx;
        currentScanResults = allResults[idx] ? JSON.parse(JSON.stringify(allResults[idx])) : {};
        voteBuffers = {};
        lockedAnswers = {};

        // Restore locks
        for (const [mid, r] of Object.entries(currentScanResults)) {
            lockedAnswers[mid] = r.answer;
        }

        const q = testData.questions[idx];
        $('current-q').textContent = idx + 1;
        $('total-q').textContent = testData.questions.length;
        $('questionText').textContent = q.text;
        $('correctLetter').textContent = LETTERS[q.correct];
        $('scannerTitle').textContent = testData.title;

        $('prev-question-btn').disabled = (idx === 0);
        $('next-question-btn').textContent = (idx === testData.questions.length - 1) ? 'Oxirgi ➡️' : 'Keyingi ➡️';

        refreshUI();
        dbg('Q' + (idx + 1) + '/' + testData.questions.length + ': ' + q.text.slice(0, 30));
    }

    // ════════════════════════════════════════
    // UI UPDATE
    // ════════════════════════════════════════
    function refreshUI() {
        const entries = Object.entries(currentScanResults);
        const correct = entries.filter(([, r]) => r.isCorrect).length;
        const wrong = entries.filter(([, r]) => !r.isCorrect).length;

        $('correct-count').textContent = correct;
        $('wrong-count').textContent = wrong;
        $('total-scanned').textContent = entries.length;

        const list = $('results-list');
        list.innerHTML = '';
        entries.forEach(([, r]) => {
            const li = document.createElement('li');
            li.className = 'result-item ' + (r.isCorrect ? 'correct' : 'wrong');
            li.innerHTML = '<span>' + r.name + '</span> <strong>' + r.answer + '</strong> ' + (r.isCorrect ? '✅' : '❌');
            list.appendChild(li);
        });
    }

    // ════════════════════════════════════════
    // CAMERA INIT & DETECTION LOOP
    // ════════════════════════════════════════
    async function startScanner() {
        dbg('Starting camera...');
        const ctx = canvasEl.getContext('2d');
        let detector;
        try {
            detector = new AR.Detector();
            dbg('Detector created OK');
        } catch (e) {
            dbg('Detector create error: ' + e.message);
            return;
        }

        // Enumerate cameras
        try {
            // Need initial getUserMedia to get labels
            const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
            tempStream.getTracks().forEach(t => t.stop());

            const devices = await navigator.mediaDevices.enumerateDevices();
            const cams = devices.filter(d => d.kind === 'videoinput');
            dbg('Cameras found: ' + cams.length);

            cameraSelect.innerHTML = '';
            cams.forEach((c, i) => {
                const opt = document.createElement('option');
                opt.value = c.deviceId;
                opt.textContent = c.label || ('Kamera ' + (i + 1));
                cameraSelect.appendChild(opt);
            });

            // Prefer back camera
            const back = cams.find(c => /back|rear|environment/i.test(c.label));
            if (back) cameraSelect.value = back.deviceId;
        } catch (e) {
            dbg('Camera enum error: ' + e.message);
            if (loadingMsg) loadingMsg.textContent = '⚠️ Kamera ruxsati berilmadi!';
            return;
        }

        // Start camera with selected device
        async function openCamera(deviceId) {
            if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());

            const constraints = {
                audio: false,
                video: deviceId
                    ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
                    : { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
            };

            try {
                cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
            } catch (e) {
                dbg('Camera open fallback...');
                cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
            }

            videoEl.srcObject = cameraStream;
            await videoEl.play();
            if (loadingMsg) loadingMsg.style.display = 'none';
            dbg('Camera opened: ' + videoEl.videoWidth + 'x' + videoEl.videoHeight);
        }

        cameraSelect.onchange = function () { openCamera(cameraSelect.value); };
        $('switchCameraBtn').onclick = function () {
            const opts = cameraSelect.options;
            const cur = cameraSelect.selectedIndex;
            cameraSelect.selectedIndex = (cur + 1) % opts.length;
            openCamera(cameraSelect.value);
        };

        // Wait for video metadata
        await openCamera(cameraSelect.value || null);

        // Detection loop
        running = true;
        let frameNum = 0;
        let lastMarkerLog = 0;

        function tick() {
            if (!running) return;

            try {
                if (videoEl.readyState >= videoEl.HAVE_ENOUGH_DATA) {
                    const w = videoEl.videoWidth;
                    const h = videoEl.videoHeight;
                    if (w > 0 && h > 0) {
                        canvasEl.width = w;
                        canvasEl.height = h;
                        ctx.drawImage(videoEl, 0, 0, w, h);

                        const imageData = ctx.getImageData(0, 0, w, h);
                        const markers = detector.detect(imageData);

                        frameNum++;

                        // Log every marker detection (throttled)
                        if (markers.length > 0 && frameNum - lastMarkerLog > 30) {
                            lastMarkerLog = frameNum;
                            var ids = [];
                            for (var mi = 0; mi < markers.length; mi++) {
                                ids.push(markers[mi].id);
                            }
                            dbg('F' + frameNum + ': ' + markers.length + ' markers, IDs=[' + ids.join(',') + ']');
                        }

                        processMarkers(ctx, markers);
                    }
                }
            } catch (e) {
                dbg('Tick err: ' + e.message);
            }
            requestAnimationFrame(tick);
        }

        tick();
    }

    // ════════════════════════════════════════
    // PROCESS DETECTED MARKERS
    // NO filtering by student ID — ALL markers are processed!
    // ════════════════════════════════════════
    function processMarkers(ctx, markers) {
        if (markers.length === 0) return;

        var q = testData.questions[currentQuestion];
        if (!q) { dbg('ERROR: no question at index ' + currentQuestion); return; }
        var correctIdx = q.correct;
        var seen = {};

        for (var i = 0; i < markers.length; i++) {
            var m = markers[i];
            var mid = m.id;

            // Skip duplicate only
            if (seen[mid]) continue;
            seen[mid] = true;

            // Measure size
            var edge = avgEdgeLen(m.corners);

            // Skip if VERY small (less than 15px — nearly invisible)
            if (edge < 15) continue;

            // Get student name (or generic if outside range)
            var name = studentName(mid);

            // ─── Already locked? Just redraw ───
            if (lockedAnswers[mid] !== undefined) {
                var locked = lockedAnswers[mid];
                var ok = (LETTERS.indexOf(locked) === correctIdx);
                drawBox(ctx, m.corners, name, locked, ok, true);
                continue;
            }

            // ─── Detect answer from marker orientation ───
            var ansIdx = detectAnswer(m.corners);
            var ans = LETTERS[ansIdx];

            // ─── Vote system ───
            if (!voteBuffers[mid]) {
                voteBuffers[mid] = { answer: ans, count: 0 };
            }

            if (voteBuffers[mid].answer === ans) {
                voteBuffers[mid].count++;
            } else {
                voteBuffers[mid] = { answer: ans, count: 1 };
            }

            var pct = Math.min(100, Math.round((voteBuffers[mid].count / VOTE_THRESHOLD) * 100));

            if (voteBuffers[mid].count >= VOTE_THRESHOLD) {
                // ── LOCK ──
                lockedAnswers[mid] = ans;
                var isOk = (ansIdx === correctIdx);
                currentScanResults[mid] = { answer: ans, isCorrect: isOk, name: name };
                refreshUI();
                drawBox(ctx, m.corners, name, ans, isOk, true);
                dbg('LOCK: ' + name + ' → ' + ans + (isOk ? ' ✓' : ' ✗') + ' (id=' + mid + ', edge=' + Math.round(edge) + ')');

                // Haptic
                try { if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred(isOk ? 'success' : 'error'); } catch (e) { }
            } else {
                // ── Scanning (orange) ──
                drawBox(ctx, m.corners, name, ans + ' ' + pct + '%', null, false);
            }
        }
    }

    // ════════════════════════════════════════
    // DRAW OVERLAY BOX ON MARKER
    // ════════════════════════════════════════
    function drawBox(ctx, corners, name, text, isCorrect, locked) {
        const color = locked ? (isCorrect ? '#00ff00' : '#ff3333') : '#ffaa00';
        const lw = locked ? 4 : 2;
        const label = name + ': ' + text + (locked ? (isCorrect ? ' ✓' : ' ✗') : '');

        ctx.strokeStyle = color;
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.stroke();

        if (locked) {
            ctx.fillStyle = isCorrect ? 'rgba(0,255,0,0.12)' : 'rgba(255,0,0,0.12)';
            ctx.fill();
        }

        // Label
        const x = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
        const y = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
        ctx.font = 'bold 14px sans-serif';
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = color;
        ctx.fillRect(x, y - 20, tw + 6, 18);
        ctx.fillStyle = '#000';
        ctx.fillText(label, x + 3, y - 5);
    }

    // ════════════════════════════════════════
    // LEADERBOARD
    // ════════════════════════════════════════
    function showLeaderboard() {
        allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        running = false;
        if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());

        scannerScreen.classList.add('scanner-hidden');
        leaderboardScreen.classList.remove('scanner-hidden');

        const scores = {};
        for (const [, results] of Object.entries(allResults)) {
            for (const [mid, r] of Object.entries(results)) {
                if (!scores[mid]) scores[mid] = { name: r.name, correct: 0, total: 0 };
                scores[mid].total++;
                if (r.isCorrect) scores[mid].correct++;
            }
        }

        const sorted = Object.entries(scores).sort(([, a], [, b]) => b.correct - a.correct);
        const medals = ['🥇', '🥈', '🥉'];
        const list = $('lbList');
        list.innerHTML = '';

        sorted.forEach(([, s], i) => {
            const row = document.createElement('div');
            row.className = 'lb-row';
            const pct = testData.questions.length > 0
                ? Math.round((s.correct / testData.questions.length) * 100) : 0;
            row.innerHTML =
                '<div class="lb-rank">' + (i < 3 ? medals[i] : (i + 1)) + '</div>' +
                '<div class="lb-name">' + s.name + '</div>' +
                '<div class="lb-score">' + s.correct + '/' + testData.questions.length + ' (' + pct + '%)</div>';
            list.appendChild(row);
        });

        if (sorted.length === 0) {
            list.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:20px;">Natijalar topilmadi</div>';
        }
    }

    // ════════════════════════════════════════
    // SEND RESULTS TO BOT (compressed)
    // ════════════════════════════════════════
    function sendResults() {
        const statusEl = $('sendStatus');

        try {
            allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));

            // Build compact JSON
            const data = {
                a: 'llab_qr_results',
                t: testData.test_id,
                n: testData.title,
                q: testData.questions.length,
                c: {}, r: {}, s: {}
            };

            testData.questions.forEach(function (q, i) { data.c[i] = q.correct; });

            for (const [qIdx, results] of Object.entries(allResults)) {
                data.r[qIdx] = {};
                for (const [mid, r] of Object.entries(results)) {
                    data.r[qIdx][mid] = LETTERS.indexOf(r.answer);
                    if (!data.s[mid]) data.s[mid] = r.name;
                }
            }

            let payload = JSON.stringify(data);
            dbg('Payload size: ' + payload.length + ' bytes');

            // If too large, send just scores
            if (payload.length > 4000) {
                const mini = { a: 'llab_qr_results', t: data.t, n: data.n, q: data.q, scores: {} };
                for (const [, results] of Object.entries(allResults)) {
                    for (const [mid, r] of Object.entries(results)) {
                        if (!mini.scores[mid]) mini.scores[mid] = { n: r.name, c: 0, t: 0 };
                        mini.scores[mid].t++;
                        if (r.isCorrect) mini.scores[mid].c++;
                    }
                }
                payload = JSON.stringify(mini);
                dbg('Using mini payload: ' + payload.length + ' bytes');
            }

            if (tg && tg.sendData) {
                tg.sendData(payload);
                if (statusEl) { statusEl.textContent = '✅ Yuborildi!'; statusEl.style.color = '#22c55e'; }
                dbg('sendData OK');
                setTimeout(function () { try { tg.close(); } catch (e) { } }, 1500);
            } else {
                dbg('tg.sendData not available');
                if (statusEl) { statusEl.textContent = '⚠️ Telegram WebApp topilmadi'; statusEl.style.color = '#ff0'; }
            }
        } catch (e) {
            dbg('Send error: ' + e.message);
            if (statusEl) { statusEl.textContent = '❌ Xatolik: ' + e.message; statusEl.style.color = '#f00'; }
        }
    }

    // ════════════════════════════════════════
    // EVENT LISTENERS
    // ════════════════════════════════════════
    $('startScannerBtn').onclick = function () {
        sessionScreen.classList.add('scanner-hidden');
        scannerScreen.classList.remove('scanner-hidden');
        showQuestion(0);
        startScanner();
    };

    $('next-question-btn').onclick = function () {
        allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        if (currentQuestion >= testData.questions.length - 1) {
            showLeaderboard();
        } else {
            showQuestion(currentQuestion + 1);
        }
    };

    $('prev-question-btn').onclick = function () {
        allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        if (currentQuestion > 0) showQuestion(currentQuestion - 1);
    };

    $('finish-test-btn').onclick = function () {
        allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        showLeaderboard();
    };

    $('sendResultsBtn').onclick = sendResults;

    // ════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════
    dbg('App v6 init');
    loadTestData();
    dbg('Ready. Press Start.');

})();
