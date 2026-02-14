// ==========================================
// SCANNER APP — SMART TESTER BOT v5
// Uses ORIGINAL cv.js + aruco.js from jcmellado
// Edge-midpoint orientation + vote-based locking
// FIXED: Student mapping by position, not DB id
// FIXED: Compressed sendData for 4096 byte limit
// ==========================================

document.addEventListener('DOMContentLoaded', async function () {

    // === TELEGRAM WEBAPP ===
    const tg = window.Telegram.WebApp;
    tg.expand();
    tg.ready();

    // === DATA ===
    let testData = null;
    let currentQuestion = 0;
    let allResults = {};       // {questionIdx: {markerIdx: {answer, isCorrect, name}}}
    let currentScanResults = {};
    let voteBuffers = {};      // {markerIdx: {answer, count}}
    let lockedAnswers = {};    // {markerIdx: answerLetter}
    let isProcessing = false;
    let currentStream = null;
    let availableCameras = [];

    // === SETTINGS ===
    const VOTE_THRESHOLD = 10;
    const MIN_MARKER_EDGE = 30;
    const ANSWER_LETTERS = ["A", "B", "C", "D"];

    // === DOM ===
    const sessionScreen = document.getElementById('sessionScreen');
    const scannerScreen = document.getElementById('scannerScreen');
    const leaderboardScreen = document.getElementById('leaderboardScreen');

    // === LOAD TEST DATA ===
    function loadTestData() {
        const params = new URLSearchParams(window.location.search);
        const encoded = params.get('data');
        if (encoded) {
            try {
                testData = JSON.parse(atob(encoded));
            } catch (e) {
                testData = null;
            }
        }

        if (!testData) {
            testData = {
                test_id: 0,
                title: "Demo Test",
                class_name: "Namuna sinf",
                students: [
                    { id: 1, name: "Ali Valiyev" },
                    { id: 2, name: "Vali Aliyev" },
                    { id: 3, name: "Sardor Karimov" },
                    { id: 4, name: "Jasur Toshmatov" },
                    { id: 5, name: "Dilshod Rahimov" }
                ],
                questions: [
                    { text: "O'zbekistonning poytaxti qaysi?", options: ["Samarqand", "Toshkent", "Buxoro", "Namangan"], correct: 1 },
                    { text: "O'zbekiston nechta viloyatdan iborat?", options: ["14", "12", "13", "15"], correct: 2 }
                ]
            };
        }

        document.getElementById('sessionTitle').textContent = testData.title;
        document.getElementById('sessionClass').textContent = testData.class_name || '—';
        document.getElementById('sessionCount').textContent = testData.questions.length + ' ta';
        document.getElementById('sessionStudents').textContent = testData.students.length + ' ta';
    }

    // === STUDENT NAME BY MARKER INDEX ===
    // Marker #0 = 1st student, Marker #1 = 2nd student, etc.
    // This is POSITION-BASED, NOT database-ID-based!
    function getStudentByMarker(markerIdx) {
        if (markerIdx >= 0 && markerIdx < testData.students.length) {
            return testData.students[markerIdx];
        }
        return null;
    }

    function getStudentName(markerIdx) {
        const student = getStudentByMarker(markerIdx);
        return student ? student.name : `#${markerIdx + 1}`;
    }

    // === MARKER EDGE LENGTH ===
    function markerEdgeLength(corners) {
        let totalLen = 0;
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            const dx = corners[i].x - corners[j].x;
            const dy = corners[i].y - corners[j].y;
            totalLen += Math.sqrt(dx * dx + dy * dy);
        }
        return totalLen / 4;
    }

    // === ORIENTATION DETECTION (edge midpoint) ===
    function getAnswerFromOrientation(corners) {
        const edgeMidY = [];
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            edgeMidY[i] = (corners[i].y + corners[j].y) / 2;
        }

        let topEdge = 0;
        let minY = edgeMidY[0];
        for (let i = 1; i < 4; i++) {
            if (edgeMidY[i] < minY) {
                minY = edgeMidY[i];
                topEdge = i;
            }
        }
        return topEdge; // 0=A, 1=B, 2=C, 3=D
    }

    // === START SCANNER ===
    document.getElementById('startScannerBtn').addEventListener('click', () => {
        sessionScreen.classList.add('scanner-hidden');
        scannerScreen.classList.remove('scanner-hidden');
        document.getElementById('scannerTitle').textContent = testData.title;
        document.getElementById('total-q').textContent = testData.questions.length;
        showQuestion(0);
        initCamera();
    });

    // === SHOW QUESTION ===
    function showQuestion(idx) {
        if (idx < 0 || idx >= testData.questions.length) return;

        // Save current results
        if (Object.keys(currentScanResults).length > 0) {
            allResults[currentQuestion] = { ...currentScanResults };
        }

        currentQuestion = idx;
        currentScanResults = allResults[idx] ? { ...allResults[idx] } : {};
        voteBuffers = {};
        lockedAnswers = {};

        // Restore locked answers
        Object.entries(currentScanResults).forEach(([id, r]) => {
            lockedAnswers[id] = r.answer;
        });

        const q = testData.questions[idx];
        document.getElementById('current-q').textContent = idx + 1;
        document.getElementById('questionText').textContent = q.text;
        document.getElementById('correctLetter').textContent = ANSWER_LETTERS[q.correct];

        document.getElementById('prev-question-btn').disabled = idx === 0;
        const isLast = idx === testData.questions.length - 1;
        document.getElementById('next-question-btn').textContent = isLast ? 'Oxirgi ➡️' : 'Keyingi ➡️';

        updateUI();
    }

    // === CAMERA ===
    async function initCamera() {
        const video = document.getElementById('videoInput');
        const canvas = document.getElementById('canvasOutput');
        const loadingMsg = document.getElementById('loadingMessage');
        const cameraSelect = document.getElementById('cameraSelect');
        const context = canvas.getContext('2d');
        const detector = new AR.Detector();

        try {
            await navigator.mediaDevices.getUserMedia({ video: true });
            const devices = await navigator.mediaDevices.enumerateDevices();
            availableCameras = devices.filter(d => d.kind === 'videoinput');

            cameraSelect.innerHTML = '';
            availableCameras.forEach((cam, i) => {
                const opt = document.createElement('option');
                opt.value = cam.deviceId;
                opt.textContent = cam.label || `Kamera ${i + 1}`;
                cameraSelect.appendChild(opt);
            });

            const back = availableCameras.find(c =>
                c.label.toLowerCase().includes('back') ||
                c.label.toLowerCase().includes('environment') ||
                c.label.toLowerCase().includes('rear')
            );
            if (back) cameraSelect.value = back.deviceId;
        } catch (e) {
            loadingMsg.textContent = "⚠️ Kamera ruxsati berilmadi!";
            return;
        }

        async function startCamera(deviceId) {
            if (currentStream) currentStream.getTracks().forEach(t => t.stop());
            const constraints = {
                audio: false,
                video: deviceId
                    ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
                    : { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
            };
            try {
                currentStream = await navigator.mediaDevices.getUserMedia(constraints);
                video.srcObject = currentStream;
                await video.play();
                loadingMsg.style.display = 'none';
            } catch (e) {
                try {
                    currentStream = await navigator.mediaDevices.getUserMedia({ video: true });
                    video.srcObject = currentStream;
                    await video.play();
                    loadingMsg.style.display = 'none';
                } catch (e2) {
                    loadingMsg.textContent = "❌ Kamera ochilmadi!";
                }
            }
        }

        cameraSelect.addEventListener('change', () => startCamera(cameraSelect.value));
        document.getElementById('switchCameraBtn').addEventListener('click', () => {
            const idx = availableCameras.findIndex(c => c.deviceId === cameraSelect.value);
            const next = (idx + 1) % availableCameras.length;
            cameraSelect.value = availableCameras[next]?.deviceId || '';
            startCamera(cameraSelect.value);
        });

        video.addEventListener('loadedmetadata', () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            if (!isProcessing) {
                isProcessing = true;
                requestAnimationFrame(tick);
            }
        });

        // === MAIN DETECTION LOOP ===
        function tick() {
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                try {
                    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                    const markers = detector.detect(imageData);
                    const q = testData.questions[currentQuestion];
                    const correctIdx = q.correct;
                    const seenThisFrame = new Set();
                    const maxStudents = testData.students.length;

                    markers.forEach(m => {
                        const c = m.corners;
                        const markerIdx = m.id; // ArUco marker ID = index in students array

                        // === FILTER: Valid student index ===
                        // Marker #0 = 1st student, #1 = 2nd student, etc.
                        if (markerIdx < 0 || markerIdx >= maxStudents) return;
                        if (seenThisFrame.has(markerIdx)) return;
                        seenThisFrame.add(markerIdx);

                        // === FILTER: Minimum size ===
                        const edgeLen = markerEdgeLength(c);
                        if (edgeLen < MIN_MARKER_EDGE) return;

                        // === DETECT ANSWER ===
                        const ansIdx = getAnswerFromOrientation(c);
                        const currentAns = ANSWER_LETTERS[ansIdx];
                        const studentName = getStudentName(markerIdx);

                        // === Already locked? ===
                        if (lockedAnswers[markerIdx] !== undefined) {
                            const locked = lockedAnswers[markerIdx];
                            const lockedIdx = ANSWER_LETTERS.indexOf(locked);
                            drawMarkerBox(context, c, lockedIdx === correctIdx, studentName, locked, true);
                            return;
                        }

                        // === VOTE (consecutive same-answer) ===
                        if (!voteBuffers[markerIdx]) {
                            voteBuffers[markerIdx] = { answer: currentAns, count: 0 };
                        }

                        if (voteBuffers[markerIdx].answer === currentAns) {
                            voteBuffers[markerIdx].count++;
                        } else {
                            voteBuffers[markerIdx] = { answer: currentAns, count: 1 };
                        }

                        const voteCount = voteBuffers[markerIdx].count;
                        const progress = Math.min(100, Math.round((voteCount / VOTE_THRESHOLD) * 100));

                        if (voteCount >= VOTE_THRESHOLD) {
                            // LOCK!
                            lockedAnswers[markerIdx] = currentAns;
                            const isCorrect = (ansIdx === correctIdx);

                            currentScanResults[markerIdx] = {
                                answer: currentAns,
                                isCorrect: isCorrect,
                                name: studentName
                            };

                            if (tg.HapticFeedback) {
                                tg.HapticFeedback.notificationOccurred(isCorrect ? 'success' : 'error');
                            }
                            updateUI();
                            drawMarkerBox(context, c, isCorrect, studentName, currentAns, true);
                        } else {
                            // Still scanning...
                            drawMarkerBox(context, c, null, studentName, `${currentAns} ${progress}%`, false);
                        }
                    });
                } catch (e) {
                    console.error("Detection error:", e);
                }
            }
            requestAnimationFrame(tick);
        }

        // Draw overlay on detected marker
        function drawMarkerBox(ctx, corners, isCorrect, name, ansText, locked) {
            let color, label, lineWidth;

            if (locked) {
                color = isCorrect ? "#00ff00" : "#ff4444";
                label = `${name}: ${ansText} ${isCorrect ? '✓' : '✗'}`;
                lineWidth = 4;
            } else {
                color = "#ffaa00";
                label = `${name}: ${ansText}`;
                lineWidth = 2;
            }

            // Draw border
            ctx.strokeStyle = color;
            ctx.lineWidth = lineWidth;
            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y);
            for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
            ctx.closePath();
            ctx.stroke();

            // Fill
            if (locked) {
                ctx.fillStyle = isCorrect ? "rgba(0,255,0,0.15)" : "rgba(255,0,0,0.15)";
                ctx.fill();
            }

            // Label background
            const x = Math.min(corners[0].x, corners[1].x, corners[2].x, corners[3].x);
            const y = Math.min(corners[0].y, corners[1].y, corners[2].y, corners[3].y);
            ctx.fillStyle = color;
            ctx.font = "bold 14px Arial";
            const tw = ctx.measureText(label).width;
            ctx.fillRect(x, y - 22, tw + 8, 20);

            ctx.fillStyle = "#000";
            ctx.fillText(label, x + 4, y - 6);
        }

        await startCamera(cameraSelect.value || null);
    }

    // === UI UPDATE ===
    function updateUI() {
        const results = Object.entries(currentScanResults);
        const correct = results.filter(([, r]) => r.isCorrect).length;
        const wrong = results.filter(([, r]) => !r.isCorrect).length;

        document.getElementById('correct-count').textContent = correct;
        document.getElementById('wrong-count').textContent = wrong;
        document.getElementById('total-scanned').textContent = results.length;

        const list = document.getElementById('results-list');
        list.innerHTML = "";
        results.forEach(([id, r]) => {
            const li = document.createElement("li");
            li.className = `result-item ${r.isCorrect ? 'correct' : 'wrong'}`;
            li.innerHTML = `<span>${r.name}</span> <strong>${r.answer}</strong> ${r.isCorrect ? '✅' : '❌'}`;
            list.appendChild(li);
        });
    }

    // === NAVIGATION ===
    document.getElementById('next-question-btn').addEventListener('click', () => {
        allResults[currentQuestion] = { ...currentScanResults };
        if (currentQuestion >= testData.questions.length - 1) {
            showLeaderboard();
        } else {
            showQuestion(currentQuestion + 1);
        }
    });

    document.getElementById('prev-question-btn').addEventListener('click', () => {
        allResults[currentQuestion] = { ...currentScanResults };
        if (currentQuestion > 0) showQuestion(currentQuestion - 1);
    });

    document.getElementById('finish-test-btn').addEventListener('click', () => {
        allResults[currentQuestion] = { ...currentScanResults };
        showLeaderboard();
    });

    // === LEADERBOARD ===
    function showLeaderboard() {
        allResults[currentQuestion] = { ...currentScanResults };

        if (currentStream) currentStream.getTracks().forEach(t => t.stop());
        isProcessing = false;

        scannerScreen.classList.add('scanner-hidden');
        leaderboardScreen.classList.remove('scanner-hidden');

        const scores = {};
        Object.entries(allResults).forEach(([qIdx, results]) => {
            Object.entries(results).forEach(([markerIdx, r]) => {
                if (!scores[markerIdx]) scores[markerIdx] = { name: r.name, correct: 0, total: 0 };
                scores[markerIdx].total++;
                if (r.isCorrect) scores[markerIdx].correct++;
            });
        });

        const sorted = Object.entries(scores)
            .sort(([, a], [, b]) => b.correct - a.correct);

        const list = document.getElementById('lbList');
        list.innerHTML = '';
        const medals = ['🥇', '🥈', '🥉'];

        sorted.forEach(([id, s], i) => {
            const row = document.createElement('div');
            row.className = 'lb-row';
            const pct = s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0;
            row.innerHTML = `
                <div class="lb-rank">${i < 3 ? medals[i] : (i + 1)}</div>
                <div class="lb-name">${s.name}</div>
                <div class="lb-score">${s.correct}/${testData.questions.length} (${pct}%)</div>
            `;
            list.appendChild(row);
        });

        if (sorted.length === 0) {
            list.innerHTML = '<div style="text-align:center;color:#94a3b8;padding:20px;">Natijalar topilmadi</div>';
        }
    }

    // === SEND RESULTS TO BOT (compressed for 4096 byte limit) ===
    document.getElementById('sendResultsBtn').addEventListener('click', () => {
        const statusEl = document.getElementById('sendStatus');

        try {
            allResults[currentQuestion] = { ...currentScanResults };

            // Build compact format
            const compact = {
                a: "llab_qr_results",
                t: testData.test_id,
                n: testData.title,
                q: testData.questions.length,
                c: {},  // correct answers per question
                r: {},  // {qIdx: {markerIdx: answerIdx}}
                s: {}   // {markerIdx: studentName}
            };

            // Correct answers
            testData.questions.forEach((q, i) => {
                compact.c[i] = q.correct;
            });

            // Student answers and names
            Object.entries(allResults).forEach(([qIdx, results]) => {
                compact.r[qIdx] = {};
                Object.entries(results).forEach(([markerIdx, r]) => {
                    compact.r[qIdx][markerIdx] = ANSWER_LETTERS.indexOf(r.answer);
                    if (!compact.s[markerIdx]) {
                        compact.s[markerIdx] = r.name;
                    }
                });
            });

            const jsonStr = JSON.stringify(compact);

            if (jsonStr.length > 4096) {
                // Too large — send scores only
                const totals = {
                    a: "llab_qr_results",
                    t: compact.t,
                    n: compact.n,
                    q: compact.q,
                    scores: {}
                };

                Object.entries(allResults).forEach(([qIdx, results]) => {
                    Object.entries(results).forEach(([mid, r]) => {
                        if (!totals.scores[mid]) {
                            totals.scores[mid] = { n: r.name, c: 0, t: 0 };
                        }
                        totals.scores[mid].t++;
                        if (r.isCorrect) totals.scores[mid].c++;
                    });
                });

                tg.sendData(JSON.stringify(totals));
            } else {
                tg.sendData(jsonStr);
            }

            if (statusEl) {
                statusEl.textContent = "✅ Natijalar botga yuborildi!";
                statusEl.style.color = "#22c55e";
            }

            // Close after short delay
            setTimeout(() => {
                try { tg.close(); } catch (e) { }
            }, 1500);

        } catch (e) {
            console.error("Send error:", e);
            if (statusEl) {
                statusEl.textContent = "❌ Xatolik: " + e.message;
                statusEl.style.color = "#ef4444";
            }
        }
    });

    // === INIT ===
    loadTestData();
});
