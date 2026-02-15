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
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.95);z-index:9999;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;font-family:sans-serif;text-align:center;padding:20px;';

    // Manual Connect Input
    var manualInputHtml = '<div id="manualConnectBox" style="margin-top:20px;display:none;">' +
        '<p style="font-size:14px;color:#ddd;margin-bottom:10px;">Ulanish kodi:</p>' +
        '<input type="number" id="manualCode" placeholder="Masalan: 5548" style="padding:12px;border-radius:5px;border:none;width:120px;text-align:center;font-size:20px;font-weight:bold;">' +
        '<br><button id="btnManual" style="margin-top:15px;padding:12px 30px;background:#3b82f6;color:white;border:none;border-radius:5px;cursor:pointer;font-size:16px;">Ulanish</button>' +
        '</div>';

    overlay.innerHTML = '<div style="font-size:50px;margin-bottom:20px;">📡</div>' +
        '<h2 style="margin:0 0 10px 0;">Serverga ulanish...</h2>' +
        '<p style="color:#aaa;font-size:14px;margin:0;">MQTT Protocol (v10)</p>' +
        '<div style="margin-top:20px;font-size:12px;color:#666;" id="connStep">Step 1: Init MQTT</div>' +
        manualInputHtml;

    document.body.appendChild(overlay);

    // Show manual input after 3 seconds
    setTimeout(function () {
        var box = document.getElementById('manualConnectBox');
        if (box) box.style.display = 'block';
    }, 3000);

    // Manual Connect Logic
    document.getElementById('btnManual').addEventListener('click', function () {
        var code = document.getElementById('manualCode').value.trim();
        if (code.length < 3) return alert('Kod juda qisqa!');

        // Re-init with new code
        updateOverlay('Kod: ' + code + ' bilan ulanish...');
        connectToMQTT(code);
    });

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

    // ─── MQTT SYNC ───
    var mqttClient = null;
    var syncCode = null;

    function initSync() {
        if (typeof mqtt === 'undefined') {
            // Retry if lib not loaded
            setTimeout(initSync, 1000);
            return;
        }

        // Get code from URL
        if (sessionId) {
            var parts = sessionId.split('-');
            syncCode = parts.length >= 3 ? parts[parts.length - 1] : null;
        }

        if (syncCode) {
            connectToMQTT(syncCode);
        } else {
            showOverlay('Kod topilmadi. Iltimos, kod kiriting.');
        }
    }

    function connectToMQTT(code) {
        if (mqttClient) { try { mqttClient.end(); } catch (e) { } }

        syncCode = code;
        updateOverlay('Serverga ulanish: ' + code);

        var clientId = 'llab_scanner_' + Math.random().toString(16).substr(2, 8);
        var host = 'wss://broker.emqx.io:8084/mqtt';

        mqttClient = mqtt.connect(host, {
            clientId: clientId,
            clean: true,
            connectTimeout: 4000
        });

        mqttClient.on('connect', function () {
            dbg('MQTT Connected');
            updateOverlay('Displayga ulanish...');
            updateSyncUI('waiting');

            // Subscribe to COMMANDS from Display
            mqttClient.subscribe('llab/sync/' + syncCode + '/command', { qos: 0 });

            // Publish STATUS
            publishStatus('scanner-ready');

            // HEARTBEAT: Keep telling Display we are here (every 3s)
            // This fixes the issue where Display misses the first message
            if (window.pingInterval) clearInterval(window.pingInterval);
            window.pingInterval = setInterval(function () {
                publishStatus('scanner-ready');
            }, 3000);

            // Allow manual access immediately if users just want to start
            // Force sync to true so we can send commands immediately
            synced = true;
            hideOverlay();
            updateSyncUI('connected');
            $('prev-question-btn').disabled = false;
            $('next-question-btn').disabled = false;
        });

        mqttClient.on('message', function (topic, message) {
            var msgStr = message.toString();

            if (topic.endsWith('/command')) {
                try {
                    var data = JSON.parse(msgStr);
                    dbg('RX Command: ' + data.type);
                    handleDisplayMessage(data);

                    if (data.type === 'display-ready' || data.type === 'ack-ready') {
                        synced = true;
                        hideOverlay();
                        updateSyncUI('connected');
                        applySyncMode(); // Maybe don't disable buttons if we want 2-way sync?
                        // Actually, let's ENABLE buttons so scanner can control too
                        $('prev-question-btn').disabled = false;
                        $('next-question-btn').disabled = false;
                    }
                } catch (e) { dbg('JSON err: ' + e); }
            }
        });

        mqttClient.on('offline', function () {
            updateSyncUI('connecting');
            showOverlay('Internet yo\'q. Qayta ulanish...');
        });

        mqttClient.on('error', function (err) {
            showOverlay('MQTT Error: ' + err.message);
        });
    }

    function syncSend(data) {
        if (mqttClient && mqttClient.connected && syncCode) {
            var msgStr = JSON.stringify(data);
            dbg('TX: ' + data.type);
            mqttClient.publish('llab/sync/' + syncCode + '/data', msgStr, { qos: 0 });
        } else {
            dbg('TX Fail: No MQTT/Code');
        }
    }

    function publishStatus(status) {
        if (mqttClient && mqttClient.connected && syncCode) {
            mqttClient.publish('llab/sync/' + syncCode + '/status', status, { qos: 0 });
        }
    }

    // Unused PeerJS functions removed/stubbed
    function handleDisplayMessage(data) {
        if (data.type === 'goto') {
            if (typeof showQuestion === 'function') showQuestion(data.payload);
        } else if (data.type === 'finish') {
            // Whiteboard says: test is done
            allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
            running = false;
            if (cameraStream) cameraStream.getTracks().forEach(function (t) { t.stop(); });
            showLeaderboard(data.allResults || allResults);
        } else if (data.type === 'sendResults') {
            // Whiteboard says: send results to Telegram bot
            sendResults();
        } else if (data.type === 'ping') {
            syncSend({ type: 'pong' });
        }
    }

    // Stub
    function connectToDisplay() { }
    function scheduleReconnect() { }

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
        // Corners: 0:TL, 1:TR, 2:BR, 3:BL (relative to marker's orientation)
        // ArUco detector sorts corners so corners[0] is our logical 'Top-Left' anchor.
        var cx = (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4;
        var cy = (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4;

        // Use atan2 to get the angle from center to corner[0]
        var angle = Math.atan2(corners[0].y - cy, corners[0].x - cx) * (180 / Math.PI);

        // Final Plickers standard mapping (v12.1):
        // Plickers uses CCW rotation: A -> B -> C -> D
        // TL (Angle < -90)    -> A
        // TR (Angle [-90, 0]) -> D  (CW 90)
        // BR (Angle [0, 90])  -> C  (180)
        // BL (Angle > 90)     -> B  (CCW 90)

        var ansIdx = 0;
        if (angle < -90) ansIdx = 0;      // A (TL)
        else if (angle < 0) ansIdx = 3;   // D (TR)
        else if (angle < 90) ansIdx = 2;  // C (BR)
        else ansIdx = 1;                  // B (BL)

        // Telemetry for final debugging
        // dbg('Angle: ' + Math.round(angle) + ' -> ' + LETTERS[ansIdx]);

        return ansIdx;
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
            // Corner 0 is our orientation anchor - make it stand out (Cyan)
            if (k === 0) {
                ctx.fillStyle = '#00ffff';
                ctx.arc(corners[k].x, corners[k].y, 6, 0, Math.PI * 2);
            } else {
                ctx.fillStyle = color;
                ctx.arc(corners[k].x, corners[k].y, 3, 0, Math.PI * 2);
            }
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

        var btnBack = $('btnBack');
        var btnFront = $('btnFront');
        var btnMore = $('btnMore');
        var camSelect = $('cameraSelect');

        function updateCamUI(mode, deviceId) {
            [btnBack, btnFront, btnMore].forEach(b => b.classList.remove('active'));
            if (mode === 'environment') btnBack.classList.add('active');
            else if (mode === 'user') btnFront.classList.add('active');
            else btnMore.classList.add('active');
        }

        async function openCamera(deviceId, facingMode) {
            if (cameraStream) {
                cameraStream.getTracks().forEach(function (t) { t.stop(); });
            }

            var constraints = { audio: false, video: {} };
            if (deviceId) {
                constraints.video.deviceId = { exact: deviceId };
            } else if (facingMode) {
                constraints.video.facingMode = facingMode;
            } else {
                constraints.video.facingMode = 'environment';
            }

            // Standard resolution for performance
            constraints.video.width = { ideal: 640 };
            constraints.video.height = { ideal: 480 };

            try {
                cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
                var track = cameraStream.getVideoTracks()[0];
                var settings = track.getSettings();

                // Persistence & UI Sync
                if (settings.deviceId) localStorage.setItem('llab_preferred_cam', settings.deviceId);
                updateCamUI(settings.facingMode, settings.deviceId);

                videoEl.srcObject = cameraStream;
                await videoEl.play();
                if (loadingMsg) loadingMsg.style.display = 'none';

                // Enumerate devices ONCE after first success to populate "More" list without extra prompts
                refreshCameraList();
            } catch (e) {
                dbg('Cam err: ' + e.message);
                if (loadingMsg) loadingMsg.textContent = '⚠️ Kamera xatoligi!';
            }
        }

        async function refreshCameraList() {
            try {
                var devices = await navigator.mediaDevices.enumerateDevices();
                var cams = devices.filter(d => d.kind === 'videoinput');
                camSelect.innerHTML = '';
                cams.forEach(c => {
                    var opt = document.createElement('option');
                    opt.value = c.deviceId;
                    opt.textContent = c.label || ('Kamera ' + camSelect.length);
                    camSelect.appendChild(opt);
                });
            } catch (e) { }
        }

        // Button Listeners
        btnBack.onclick = () => openCamera(null, 'environment');
        btnFront.onclick = () => openCamera(null, 'user');
        btnMore.onclick = () => {
            camSelect.style.display = camSelect.style.display === 'none' ? 'block' : 'none';
            if (camSelect.style.display === 'block') refreshCameraList();
        };
        camSelect.onchange = () => {
            openCamera(camSelect.value);
            camSelect.style.display = 'none';
        };

        // Initial Start (v12.5 Persistence Logic)
        var savedCam = localStorage.getItem('llab_preferred_cam');
        if (savedCam) {
            openCamera(savedCam);
        } else {
            openCamera(null, 'environment');
        }

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

            var ansIdx = detectAnswer(m.corners);
            var ans = LETTERS[ansIdx];

            // Answer Consistency Buffer
            if (!voteBuffers[mid]) voteBuffers[mid] = { answer: ans, count: 0 };

            if (voteBuffers[mid].answer === ans) {
                voteBuffers[mid].count++;
            } else {
                // Answer changed - restart buffer (hysteresis)
                voteBuffers[mid] = { answer: ans, count: 1 };
            }

            var pct = Math.min(100, Math.round((voteBuffers[mid].count / VOTE_THRESHOLD) * 100));

            // Logic: Lock answer if threshold reached
            // If already locked, but detecting a different answer consistently, RE-LOCK.
            if (voteBuffers[mid].count >= VOTE_THRESHOLD) {
                var previousAns = lockedAnswers[mid];

                if (previousAns !== ans) {
                    // LOCK / RE-LOCK
                    lockedAnswers[mid] = ans;
                    var isOk = (ansIdx === correctIdx);
                    currentScanResults[mid] = { answer: ans, isCorrect: isOk, name: name };

                    // SAVE IMMEDIATELY to Global buffer (Consistency Fix v12.3)
                    allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));

                    refreshUI();
                    drawOverlay(ctx, m.corners, name, ans, isOk, true);
                    dbg((previousAns ? '↻ ' : '✓ ') + name + ' → ' + ans + (isOk ? ' ✓' : ' ✗'));

                    // SYNC: send lock/update to display
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
                    // Constant detection of already locked answer
                    drawOverlay(ctx, m.corners, name, ans, (ansIdx === correctIdx), true);
                }
            } else {
                // Progressing towards lock/re-lock
                var isCurrentlyLocked = (lockedAnswers[mid] !== undefined);
                var overlayAns = isCurrentlyLocked ? (lockedAnswers[mid] + ' ➔ ' + ans) : ans;

                drawOverlay(ctx, m.corners, name, overlayAns + ' ' + pct + '%', null, false);

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

        var currentRank = 1;
        var displayRank = 1;

        for (var i = 0; i < sorted.length; i++) {
            var s = sorted[i];

            // Standard Competition Ranking: 1, 1, 3...
            if (i > 0 && s.correct < sorted[i - 1].correct) {
                displayRank = i + 1;
            }

            var p = totalQ > 0 ? Math.round((s.correct / totalQ) * 100) : 0;
            var row = document.createElement('div');
            row.className = 'lb-row';

            var medalIdx = displayRank - 1;
            row.innerHTML =
                '<div class="lb-rank">' + (medalIdx < 3 ? medals[medalIdx] : displayRank) + '</div>' +
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
            // Save current question results first
            allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));

            // 1. MQTT SEND (Python Bot) - Works in Browser & WebApp
            if (mqttClient && mqttClient.connected && testData.chat_id) {
                var mqttPayload = {
                    chat_id: testData.chat_id,
                    results: allResults,
                    total_q: testData.questions.length, // Precision fix
                    title: testData.title              // Context fix
                };
                mqttClient.publish('llab/results', JSON.stringify(mqttPayload), { qos: 0 });
                if (statusEl) { statusEl.textContent = '✅ Botga yuborildi!'; statusEl.style.color = '#22c55e'; }
                dbg('Results sent via MQTT to ' + testData.chat_id);
            }

            // 2. TG WEBAPP SEND (Legacy/Fallback)
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
                // Only show warning if MQTT also failed (i.e. we didn't update status yet)
                if (!mqttClient || !mqttClient.connected) {
                    if (statusEl) { statusEl.textContent = '⚠️ TG/MQTT topilmadi'; statusEl.style.color = '#ffaa00'; }
                }
                dbg('sendData: TG not available');
            }
        } catch (e) {
            if (statusEl) { statusEl.textContent = '❌ ' + e.message; statusEl.style.color = '#ff3344'; }
        }
    }

    // Helper to show finish screen
    function showFinishScreen() {
        allResults[currentQuestion] = JSON.parse(JSON.stringify(currentScanResults));
        running = false;
        if (cameraStream) cameraStream.getTracks().forEach(function (t) { t.stop(); });

        // Sync final state to Display (v12.4 Consistency Fix)
        if (synced && syncCode) {
            syncSend({
                type: 'finish',
                allResults: allResults
            });
        }

        showLeaderboard();
    }

    // ════════════════════════════════════════
    // CONTROLS
    // ════════════════════════════════════════
    $('prev-question-btn').addEventListener('click', function () {
        if (currentQuestion > 0) {
            var newIdx = currentQuestion - 1;
            showQuestion(newIdx);
            // Sync to display: Scanner -> Display
            if (synced && syncCode) {
                syncSend({ type: 'goto', payload: newIdx });
            }
        }
    });

    $('next-question-btn').addEventListener('click', function () {
        if (currentQuestion < testData.questions.length - 1) {
            var newIdx = currentQuestion + 1;
            showQuestion(newIdx);
            // Sync to display: Scanner -> Display
            if (synced && syncCode) {
                syncSend({ type: 'goto', payload: newIdx });
            }
        } else {
            // Finish test locally?? Usually display finishes.
            // But if user clicks finish on scanner:
            showFinishScreen();
        }
    });

    $('finish-test-btn').addEventListener('click', function () {
        showFinishScreen();
        if (synced && syncCode) {
            syncSend({ type: 'finish' });
        }
    });

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

    // ════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════
    dbg('v11.2 SLAVE init');
    loadTestData();
    initSync();

})();
