// ==========================================
// LLAB QR SCANNER — v10 WAYGROUND UI
// Premium 3-View Architecture (Quiz -> Cam -> Results)
// ==========================================

(function () {
    'use strict';

    // ─── DEBUG ───
    var debugEl = document.getElementById('debugConsole');
    function dbg(msg) {
        console.log('[SCAN]', msg);
        if (debugEl) {
            debugEl.style.display = 'block';
            debugEl.textContent = msg + '\n' + (debugEl.textContent || '').slice(0, 600);
        }
    }

    // ─── TELEGRAM WEBAPP ───
    var tg = null;
    try {
        tg = window.Telegram && window.Telegram.WebApp;
        if (tg) { tg.expand(); tg.ready(); }
    } catch (e) { }

    // ─── CHECK LIBRARIES ───
    if (typeof CV === 'undefined') { dbg('ERROR: CV not loaded!'); return; }
    if (typeof AR === 'undefined') { dbg('ERROR: AR not loaded!'); return; }

    // ─── CONSTANTS ───
    var LETTERS = ['A', 'B', 'C', 'D'];

    // ─── STATE ───
    var testData = null;
    var currentQuestion = 0;
    var allResults = {};         // {qIdx: {mid: {answer, isCorrect, name}}}
    var currentScanResults = {}; // current question results
    var voteBuffers = {};
    var lockedAnswers = {};
    var cameraStream = null;
    var isScanning = false;
    var synced = false;

    // ─── VIEWS ───
    var views = {
        lobby: document.getElementById('sessionScreen'),
        quiz: document.getElementById('quizView'),
        camera: document.getElementById('cameraView'),
        leaderboard: document.getElementById('leaderboardScreen')
    };

    function switchView(viewName) {
        for (var key in views) {
            if (views[key]) views[key].classList.remove('active');
        }
        if (views[viewName]) views[viewName].classList.add('active');

        // Handle Camera start/stop based on view
        if (viewName === 'camera') {
            startCamera();
        } else {
            stopCamera();
        }
    }

    // ─── SUPABASE SYNC ───
    var activeChannel = null;
    var urlParams = new URLSearchParams(window.location.search);
    var testId = urlParams.get('test_id');
    var classId = urlParams.get('class_id') || 0;
    // Pult mode support removed or kept generic here
    var dataB64 = urlParams.get('data');

    function initSync() {
        if (!testId || !dataB64) {
            alert("No test data found in URL!");
            return;
        }

        try {
            testData = JSON.parse(decodeURIComponent(escape(atob(dataB64))));
        } catch (e) {
            alert("Kodni o'qishda xatolik: " + e.message);
            return;
        }

        buildLobby();

        if (typeof window.supabaseClient === 'undefined') {
            dbg('Supabase client error!');
            return;
        }

        // Setup real-time connection
        var channelName = 'session-' + testId + '-' + classId;
        activeChannel = window.supabaseClient.channel(channelName);
        activeChannel.subscribe(function (status) {
            var syncDot = document.querySelector('.sync-dot');
            var syncText = document.getElementById('syncStatus');
            if (status === 'SUBSCRIBED') {
                synced = true;
                if (syncDot) syncDot.classList.remove('offline');
                if (syncText) syncText.innerHTML = '<div class="sync-dot"></div> Sinxron';
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                synced = false;
                if (syncDot) syncDot.classList.add('offline');
                if (syncText) syncText.innerHTML = '<div class="sync-dot offline"></div> Uzilgan';
            }
        });
    }

    // Broadcaster to Display
    function broadcast(action, payload) {
        if (!synced || !activeChannel) return;
        activeChannel.send({
            type: 'broadcast',
            event: 'control',
            payload: { action: action, data: payload }
        });
    }

    function broadcastScan(studentId, answer, isCorrect) {
        if (!synced || !activeChannel) return;
        activeChannel.send({
            type: 'broadcast',
            event: 'remote_signal',
            payload: { student_id: studentId, answer: answer, is_correct: isCorrect }
        });
    }

    // ─── UI BUILDERS ───
    function buildLobby() {
        document.getElementById('sessionTitle').textContent = testData.title || "L-Lab Vision Test";
        document.getElementById('sessionCount').textContent = testData.questions ? testData.questions.length : 0;
        document.getElementById('sessionStudents').textContent = testData.students ? testData.students.length : 0;
        switchView('lobby');
    }

    document.getElementById('startScannerBtn').addEventListener('click', function () {
        showQuizView(0);
        broadcast('start', 0);
    });

    // 1. QUIZ VIEW
    function showQuizView(idx) {
        var qCount = testData.questions.length;
        if (idx < 0) idx = 0;
        if (idx >= qCount) {
            showLeaderboard();
            broadcast('finish', null);
            return;
        }

        currentQuestion = idx;
        var q = testData.questions[idx];

        document.getElementById('current-q').textContent = idx + 1;
        document.getElementById('total-q').textContent = qCount;
        document.getElementById('questionText').textContent = q.text;

        // Reset Options Pre-Scan State
        var preScan = document.getElementById('preScanOptions');
        var postScan = document.getElementById('postScanResults');
        document.getElementById('btnScanMode').style.display = 'block';
        document.getElementById('btnNextQ').style.display = 'none';

        preScan.style.display = 'flex';
        postScan.style.display = 'none';

        var opts = preScan.querySelectorAll('.wg-option .opt-text');
        var letters = ['A', 'B', 'C', 'D'];
        for (var i = 0; i < 4; i++) {
            if (q.options && q.options[i]) {
                opts[i].textContent = q.options[i];
            } else {
                opts[i].textContent = "Variant " + letters[i];
            }
        }

        switchView('quiz');
        broadcast('next', idx);
    }

    // 2. RESULTS PROGRESS VIEW (After Submit)
    function showResultsView() {
        var q = testData.questions[currentQuestion];
        var preScan = document.getElementById('preScanOptions');
        var postScan = document.getElementById('postScanResults');

        document.getElementById('btnScanMode').style.display = 'none';
        var nextBtn = document.getElementById('btnNextQ');
        nextBtn.style.display = 'block';

        if (currentQuestion >= testData.questions.length - 1) {
            nextBtn.textContent = 'Finish Quiz';
            nextBtn.classList.replace('wg-purple', 'wg-danger');
            nextBtn.innerHTML = '<i class="fas fa-flag-checkered"></i> Finish Quiz';
        } else {
            nextBtn.textContent = 'Next question';
            nextBtn.classList.replace('wg-danger', 'wg-purple');
            nextBtn.innerHTML = 'Next question <i class="fas fa-arrow-right"></i>';
        }

        preScan.style.display = 'none';
        postScan.style.display = 'flex';

        // Tally results
        var counts = { A: 0, B: 0, C: 0, D: 0 };
        var total = 0;
        for (var mid in currentScanResults) {
            var ans = currentScanResults[mid].answer;
            if (counts[ans] !== undefined) {
                counts[ans]++;
                total++;
            }
        }

        document.getElementById('total-responses').textContent = total;

        var letters = ['A', 'B', 'C', 'D'];
        for (var i = 0; i < 4; i++) {
            var l = letters[i];
            var bar = document.getElementById('resBar' + l);
            var fill = bar.querySelector('.res-fill');
            var txt = bar.querySelector('.res-text');
            var cnt = bar.querySelector('.res-count');

            // Text
            txt.textContent = (q.options && q.options[i]) ? q.options[i] : "Variant " + l;
            // Count
            cnt.textContent = counts[l];

            // Width
            var pct = total > 0 ? (counts[l] / total) * 100 : 0;
            fill.style.width = pct + '%';

            // Color correct/wrong
            fill.classList.remove('correct', 'wrong');
            if (i === q.correct) {
                fill.classList.add('correct');
            } else if (counts[l] > 0) {
                // only paint red if someone actually voted for it
                fill.classList.add('wrong');
            }
        }
    }


    // ─── SCANNED LOGIC ───

    function refreshScannedUI() {
        var count = 0;

        for (var mid in currentScanResults) {
            count++;
        }

        document.getElementById('sheet-scanned-count').textContent = count;

        var btnSubmit = document.getElementById('btnSubmitScans');
        btnSubmit.disabled = (count === 0);
    }


    // ─── BUTTON HOOKS ───
    document.getElementById('btnScanMode').addEventListener('click', function () {

        // Load existing saved results if any
        if (allResults[currentQuestion]) {
            currentScanResults = JSON.parse(JSON.stringify(allResults[currentQuestion]));
            for (var mid in currentScanResults) {
                lockedAnswers[mid] = currentScanResults[mid].answer;
            }
        } else {
            currentScanResults = {};
            lockedAnswers = {};
            voteBuffers = {};
        }

        refreshScannedUI();
        switchView('camera');
        broadcast('scan_start', currentQuestion);
    });

    document.getElementById('btnSubmitScans').addEventListener('click', function () {
        // Save results to allResults
        allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));

        // Go back to Quiz View in Results Mode
        switchView('quiz');
        showResultsView();

        // Broadcast to whiteboard to also show results
        broadcast('scan_submit', currentQuestion);
    });

    document.getElementById('btnCloseCam').addEventListener('click', function () {
        switchView('quiz');
    });

    document.getElementById('btnNextQ').addEventListener('click', function () {
        showQuizView(currentQuestion + 1);
    });

    document.getElementById('btnSkip').addEventListener('click', function () {
        if (confirm('Bu savolni o\'tkazib yuborasizmi?')) {
            showQuizView(currentQuestion + 1);
        }
    });

    document.getElementById('btnEndQuiz').addEventListener('click', function () {
        if (confirm('Testni muddatidan oldin yakunlaysizmi?')) {
            showLeaderboard();
            broadcast('finish', null);
        }
    });


    // ─── CAMERA LOGIC & ARUCO ───
    var videoEl = document.getElementById('videoInput');
    var canvasEl = document.getElementById('canvasOutput');
    var frameTimer = null;
    var facingMode = 'environment';

    // Zoom State
    var currentZoom = 1;
    var maxZoom = 1;
    var minZoom = 1;

    document.getElementById('btnZoomIn').addEventListener('click', function () {
        if (!cameraStream) return;
        var track = cameraStream.getVideoTracks()[0];
        try {
            var capabilities = track.getCapabilities();
            if (capabilities.zoom) {
                currentZoom = Math.min(maxZoom, currentZoom + 0.5);
                track.applyConstraints({ advanced: [{ zoom: currentZoom }] });
            } else {
                throw new Error("No native zoom");
            }
        } catch (e) {
            // Fallback to CSS digital zoom
            maxZoom = 4;
            currentZoom = Math.min(maxZoom, currentZoom + 0.5);
            document.getElementById('videoInput').style.transform = 'scale(' + currentZoom + ')';
            document.getElementById('canvasOutput').style.transform = 'scale(' + currentZoom + ')';
        }
        document.getElementById('zoomLevelIndicator').textContent = currentZoom.toFixed(1) + 'x';
    });

    document.getElementById('btnZoomOut').addEventListener('click', function () {
        if (!cameraStream) return;
        var track = cameraStream.getVideoTracks()[0];
        try {
            var capabilities = track.getCapabilities();
            if (capabilities.zoom) {
                currentZoom = Math.max(minZoom, currentZoom - 0.5);
                track.applyConstraints({ advanced: [{ zoom: currentZoom }] });
            } else {
                throw new Error("No native zoom");
            }
        } catch (e) {
            // Fallback to CSS digital zoom
            currentZoom = Math.max(minZoom, currentZoom - 0.5);
            document.getElementById('videoInput').style.transform = 'scale(' + currentZoom + ')';
            document.getElementById('canvasOutput').style.transform = 'scale(' + currentZoom + ')';
        }
        document.getElementById('zoomLevelIndicator').textContent = currentZoom.toFixed(1) + 'x';
    });

    document.getElementById('btnFlipCam').addEventListener('click', function () {
        facingMode = (facingMode === 'environment') ? 'user' : 'environment';
        // Force fully stop camera to switch facing mode
        if (cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop());
            cameraStream = null;
        }
        startCamera();
    });

    async function startCamera() {
        if (cameraStream && cameraStream.active) {
            // Already have an active stream, just re-attach and play
            isScanning = true;
            document.getElementById('loadingMessage').style.display = 'block';
            videoEl.srcObject = cameraStream;
            videoEl.play();
            return;
        }

        stopCamera();
        isScanning = true;
        var constraints = { audio: false, video: { facingMode: facingMode, width: { ideal: 640 }, height: { ideal: 480 } } };
        document.getElementById('loadingMessage').style.display = 'block';
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
            videoEl.srcObject = cameraStream;
            videoEl.play();
            videoEl.onloadedmetadata = function () {
                document.getElementById('loadingMessage').style.display = 'none';
                canvasEl.width = videoEl.videoWidth;
                canvasEl.height = videoEl.videoHeight;

                // Init Zoom
                try {
                    var track = cameraStream.getVideoTracks()[0];
                    var capabilities = track.getCapabilities();
                    if (capabilities.zoom) {
                        maxZoom = capabilities.zoom.max;
                        minZoom = capabilities.zoom.min;
                        var settings = track.getSettings();
                        currentZoom = settings.zoom || 1;
                        document.getElementById('zoomLevelIndicator').textContent = currentZoom.toFixed(1) + 'x';
                    } else {
                        document.getElementById('zoomLevelIndicator').textContent = '1x';
                    }
                } catch (e) { }

                requestAnimationFrame(processVideo);
            };
        } catch (e) {
            dbg('Cam Error: ' + e.message);
            document.getElementById('loadingMessage').textContent = 'Kamera ruxsati berilmadi!';
        }
    }

    function stopCamera() {
        isScanning = false;
        if (frameTimer) cancelAnimationFrame(frameTimer);
        // Do not stop the tracks here so we can reuse the stream.
        // We will only pause the video element.
        if (videoEl) {
            videoEl.pause();
        }
    }

    function processVideo() {
        if (!isScanning) return;
        try {
            var ctx = canvasEl.getContext('2d');
            ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
            var imgData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
            var detector = new AR.Detector();
            var markers = detector.detect(imgData);
            drawMarkers(ctx, markers);
        } catch (e) { }
        frameTimer = requestAnimationFrame(processVideo);
    }

    function getStudentByMarkerId(id) {
        if (!testData || !testData.students) return { id: id, name: "P " + (id + 1) };
        var list = testData.students;
        for (var i = 0; i < list.length; i++) {
            if (parseInt(list[i].remote_id) === (id + 1)) return list[i];
        }
        return { id: id, name: "P " + (id + 1) };
    }

    function avgEdgeLength(c) {
        var sum = 0;
        for (var i = 0; i < 4; i++) {
            var j = (i + 1) % 4;
            var dx = c[i].x - c[j].x, dy = c[i].y - c[j].y;
            sum += Math.sqrt(dx * dx + dy * dy);
        }
        return sum / 4;
    }

    function drawMarkers(ctx, markers) {
        var VOTE_LIMIT = 5;

        for (var i = 0; i < markers.length; i++) {
            var m = markers[i];
            if (m.id > 100) continue; // Noise
            if (avgEdgeLength(m.corners) < 20) continue; // Too small

            var stud = getStudentByMarkerId(m.id);
            var mid = m.id.toString();

            // Calculate Answer by orientation (Top edge index)
            // 0=A, 1=D(right), 2=C(bottom), 3=B(left) -> Mapping to A,B,C,D
            var dirObj = m.getRotation ? m.getRotation() : { roll: 0 };
            var rawAns = '?';

            // Standard bounding box rotation logic based on ARuCo corners
            var dx = m.corners[1].x - m.corners[0].x;
            var dy = m.corners[1].y - m.corners[0].y;
            var angle = Math.atan2(dy, dx) * 180 / Math.PI;

            // Normalizing angle to map exactly to the design layout
            // A=top, B=left, C=bottom, D=right
            if (angle > -45 && angle <= 45) rawAns = 'A';
            else if (angle > 45 && angle <= 135) rawAns = 'D';
            else if (angle > 135 || angle <= -135) rawAns = 'C';
            else rawAns = 'B';

            var q = testData.questions[currentQuestion];
            var correctAns = LETTERS[q.correct];

            if (!voteBuffers[mid]) voteBuffers[mid] = { A: 0, B: 0, C: 0, D: 0 };
            voteBuffers[mid][rawAns]++;

            // Lock answer if threshold met
            if (!lockedAnswers[mid] && voteBuffers[mid][rawAns] >= VOTE_LIMIT) {
                var isCorrect = (rawAns === correctAns);
                lockedAnswers[mid] = rawAns;
                currentScanResults[mid] = {
                    student_id: stud.id,
                    name: stud.name,
                    answer: rawAns,
                    isCorrect: isCorrect,
                    time: Date.now()
                };

                // Play sound! Beep
                // Ovoz o'chirildi - foydalanuvchi talabiga binoan

                if (navigator.vibrate) navigator.vibrate(50);

                // Realtime broadcast to WB
                broadcastScan(stud.id, rawAns, isCorrect);

                // Update UI Bottom Sheet
                refreshScannedUI();
            }

            var lckAns = lockedAnswers[mid];
            var isLckCorrect = lckAns === correctAns;

            // DRAW Wayground Style Floating Badge
            var textAns = lckAns ? lckAns : rawAns;
            var textBody = "";
            var pName = "P " + (m.id + 1);
            if (stud.name && stud.name !== pName) {
                textBody = stud.name.split(' ')[0] + " " + (m.id + 1);
            } else {
                textBody = pName;
            }

            ctx.font = 'bold 14px sans-serif';
            var ansWidth = 26; // Width of the colored square
            var bodyWidth = ctx.measureText(textBody).width + 16;
            var totalWidth = ansWidth + bodyWidth;
            var h = 28; // Height of the badge
            var r = 6;  // Border radius

            var minX = m.corners[0].x, minY = m.corners[0].y;
            for (var p = 1; p < 4; p++) {
                if (m.corners[p].x < minX) minX = m.corners[p].x;
                if (m.corners[p].y < minY) minY = m.corners[p].y;
            }

            var badgeX = minX;
            var badgeY = minY - 40;

            // 1. Draw Background Pill (Dark Grey)
            ctx.fillStyle = 'rgba(28, 28, 28, 0.9)'; // Wayground Dark
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(badgeX, badgeY, totalWidth, h, r);
                ctx.fill();
            } else {
                ctx.fillRect(badgeX, badgeY, totalWidth, h);
            }

            // 2. Draw Colored Square (Left Side for Answer)
            var squareColor = '#555555'; // default grey if not locked
            if (lckAns) {
                squareColor = isLckCorrect ? '#22c55e' : '#ef4444';
            }

            ctx.fillStyle = squareColor;
            if (ctx.roundRect) {
                ctx.beginPath();
                ctx.roundRect(badgeX + 2, badgeY + 2, ansWidth - 4, h - 4, r - 2);
                ctx.fill();
            } else {
                ctx.fillRect(badgeX + 2, badgeY + 2, ansWidth - 4, h - 4);
            }

            // 3. Draw Answer Text inside the Square
            ctx.fillStyle = '#fff';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = 'bold 13px sans-serif';
            ctx.fillText(textAns, badgeX + (ansWidth / 2) + 1, badgeY + (h / 2) + 1);

            // 4. Draw Student Name outside the Square
            ctx.textAlign = 'left';
            ctx.font = 'bold 14px sans-serif';
            ctx.fillText(textBody, badgeX + ansWidth + 6, badgeY + (h / 2) + 1);
        }
    }


    // ─── LEADERBOARD & SAVE ───
    function showLeaderboard() {
        // Stop completely when showing leaderboard
        isScanning = false;
        if (frameTimer) cancelAnimationFrame(frameTimer);
        if (cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop());
            cameraStream = null;
        }
        if (videoEl) videoEl.pause();

        var lb = {};
        if (testData && testData.students) {
            testData.students.forEach(s => {
                lb[s.id] = { name: s.name, total: 0, correct: 0 };
            });
        }

        for (var qIdx in allResults) {
            var qData = allResults[qIdx];
            for (var mid in qData) {
                var sId = qData[mid].student_id;
                if (!lb[sId]) lb[sId] = { name: qData[mid].name, total: 0, correct: 0 };
                lb[sId].total++;
                if (qData[mid].isCorrect) lb[sId].correct++;
            }
        }

        var arr = [];
        for (var k in lb) arr.push({ id: k, ...lb[k] });

        arr.sort((a, b) => {
            if (b.correct !== a.correct) return b.correct - a.correct;
            return a.name.localeCompare(b.name);
        });

        var list = document.getElementById('lbList');
        list.innerHTML = '';
        for (var i = 0; i < arr.length; i++) {
            var row = document.createElement('div');
            row.className = 'lb-row';
            row.innerHTML = `<div class="lb-rank">${i + 1}</div>
                             <div class="lb-name">${arr[i].name}</div>
                             <div class="lb-score">${arr[i].correct}</div>`;
            list.appendChild(row);
        }

        switchView('leaderboard');
    }

    document.getElementById('sendResultsBtn').addEventListener('click', async function () {
        var btn = this;
        var st = document.getElementById('sendStatus');
        btn.disabled = true;
        btn.textContent = 'Yuborilmoqda...';
        st.textContent = 'Supabase bazasiga yozilmoqda...';

        if (typeof window.supabaseClient === 'undefined') {
            st.textContent = 'Kutubxona xatosi!';
            return;
        }

        var payload = {
            test_id: parseInt(testId),
            class_id: parseInt(classId),
            created_at: new Date().toISOString(),
            results: allResults
        };

        try {
            const { data, error } = await window.supabaseClient.from('bot_group_sessions').insert([payload]);
            if (error) throw error;
            st.textContent = 'Natijalar bazaga saqlandi! Telegramni yopishingiz mumkin.';
            st.style.color = '#22c55e';
            btn.innerHTML = '✅ Saqlandi';
            if (tg) tg.close();
        } catch (e) {
            st.textContent = 'Xatolik: ' + e.message;
            st.style.color = '#ef4444';
            btn.disabled = false;
            btn.textContent = 'Qaytadan urinish';
        }
    });

    // ─── START ───
    initSync();

})();
