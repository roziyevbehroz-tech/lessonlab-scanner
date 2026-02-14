// ==========================================
// SCANNER APP — SMART TESTER BOT
// Uses external cv.js + aruco.js libraries
// ==========================================

document.addEventListener('DOMContentLoaded', async function () {

    // === TELEGRAM WEBAPP ===
    const tg = window.Telegram.WebApp;
    tg.expand();
    tg.ready();

    // === TEST DATA ===
    let testData = null;
    let currentQuestion = 0;
    let allResults = {};       // {questionIdx: {studentId: {answer, isCorrect, name}}}
    let currentScanResults = {};
    let frameBuffers = {};
    let isProcessing = false;
    let currentStream = null;
    let availableCameras = [];
    const BUFFER_SIZE = 5;
    const ANSWER_LETTERS = ["A", "B", "C", "D"];

    // === DOM ===
    const sessionScreen = document.getElementById('sessionScreen');
    const scannerScreen = document.getElementById('scannerScreen');
    const leaderboardScreen = document.getElementById('leaderboardScreen');

    // === LOAD TEST DATA FROM URL ===
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
            // Demo mode
            testData = {
                test_id: 0,
                title: "Demo Test",
                class_name: "Namuna sinf",
                students: [
                    { id: 1, name: "Ali Valiyev" },
                    { id: 2, name: "Vali Aliyev" },
                    { id: 3, name: "Sardor Karimov" }
                ],
                questions: [
                    { text: "Father tarjimasi?", options: ["Ota", "Ona", "Aka", "Uka"], correct: 0 },
                    { text: "Mother tarjimasi?", options: ["Ota", "Ona", "Aka", "Opacha"], correct: 1 }
                ]
            };
        }

        // Fill session screen
        document.getElementById('sessionTitle').textContent = testData.title;
        document.getElementById('sessionClass').textContent = testData.class_name || '—';
        document.getElementById('sessionCount').textContent = testData.questions.length + ' ta';
        document.getElementById('sessionStudents').textContent = testData.students.length + ' ta';
    }

    // === GET STUDENT NAME BY MARKER ID ===
    function getStudentName(markerId) {
        // ArUco marker ID 0 → student 1, ID 1 → student 2, etc.
        const studentNum = markerId + 1;
        const student = testData.students.find(s => s.id === studentNum);
        return student ? student.name : `#${studentNum}`;
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

        // Save previous results before switching
        if (Object.keys(currentScanResults).length > 0) {
            allResults[currentQuestion] = { ...currentScanResults };
        }

        currentQuestion = idx;

        // Load existing results for this question
        currentScanResults = allResults[idx] ? { ...allResults[idx] } : {};
        frameBuffers = {};

        const q = testData.questions[idx];
        document.getElementById('current-q').textContent = idx + 1;
        document.getElementById('questionText').textContent = q.text;
        document.getElementById('correctLetter').textContent = ANSWER_LETTERS[q.correct];

        // Update navigation
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

        // Get cameras
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

            // Prefer back camera
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

        // Video ready → set canvas dimensions + start detection
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
                // Draw video frame
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                context.drawImage(video, 0, 0, canvas.width, canvas.height);

                try {
                    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                    const markers = detector.detect(imageData);
                    const q = testData.questions[currentQuestion];
                    const correctIdx = q.correct;

                    markers.forEach(m => {
                        const c = m.corners;
                        const markerId = m.id;          // ArUco ID (0-based)
                        const studentId = markerId + 1;  // Student number (1-based)

                        // Detect answer from orientation: topmost corner = selected answer
                        let minY = Infinity, topIdx = -1;
                        c.forEach((p, i) => { if (p.y < minY) { minY = p.y; topIdx = i; } });
                        const currentAns = ANSWER_LETTERS[topIdx] || "?";
                        const answerIdx = topIdx;

                        // Lock-in buffer (prevents flickering)
                        if (!frameBuffers[studentId]) frameBuffers[studentId] = [];
                        frameBuffers[studentId].push(currentAns);
                        if (frameBuffers[studentId].length > BUFFER_SIZE) frameBuffers[studentId].shift();

                        const isStable = frameBuffers[studentId].length >= BUFFER_SIZE &&
                            frameBuffers[studentId].every(a => a === currentAns);

                        if (isStable) {
                            const isCorrect = (answerIdx === correctIdx);
                            drawMarkerBox(context, c, isCorrect, studentId, currentAns);

                            if (!currentScanResults[studentId] || currentScanResults[studentId].answer !== currentAns) {
                                currentScanResults[studentId] = {
                                    answer: currentAns,
                                    isCorrect: isCorrect,
                                    name: getStudentName(markerId)
                                };
                                if (tg.HapticFeedback) {
                                    tg.HapticFeedback.notificationOccurred(isCorrect ? 'success' : 'error');
                                }
                                updateUI();
                            }
                        } else {
                            drawMarkerBox(context, c, null, studentId, currentAns);
                        }
                    });
                } catch (e) {
                    // Silent error — don't break the loop
                    console.error("Detection error:", e);
                }
            }
            requestAnimationFrame(tick);
        }

        // Draw colored box around detected marker
        function drawMarkerBox(ctx, corners, isCorrect, id, ans) {
            const name = getStudentName(id - 1);
            let color = "#888888";
            let label = `${name}: ${ans} ...`;

            if (isCorrect === true) { color = "#00ff00"; label = `${name}: ${ans} ✓`; }
            else if (isCorrect === false) { color = "#ff4444"; label = `${name}: ${ans} ✗`; }

            // Draw border
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(corners[0].x, corners[0].y);
            corners.forEach(p => ctx.lineTo(p.x, p.y));
            ctx.closePath();
            ctx.stroke();

            // Fill semi-transparent
            ctx.fillStyle = isCorrect === null ? "rgba(128,128,128,0.2)" :
                (isCorrect ? "rgba(0,255,0,0.15)" : "rgba(255,0,0,0.15)");
            ctx.fill();

            // Label background
            ctx.fillStyle = color;
            ctx.font = "bold 18px Arial";
            const textWidth = ctx.measureText(label).width;
            ctx.fillRect(corners[0].x, corners[0].y - 30, textWidth + 10, 26);

            // Label text
            ctx.fillStyle = "#000";
            ctx.fillText(label, corners[0].x + 5, corners[0].y - 10);
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

        // Stop camera
        if (currentStream) currentStream.getTracks().forEach(t => t.stop());
        isProcessing = false;

        scannerScreen.classList.add('scanner-hidden');
        leaderboardScreen.classList.remove('scanner-hidden');

        // Calculate scores
        const scores = {};
        Object.entries(allResults).forEach(([qIdx, results]) => {
            Object.entries(results).forEach(([studentId, r]) => {
                if (!scores[studentId]) scores[studentId] = { name: r.name, correct: 0, total: 0 };
                scores[studentId].total++;
                if (r.isCorrect) scores[studentId].correct++;
            });
        });

        // Sort by correct answers (descending)
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

    // === SEND RESULTS TO BOT ===
    document.getElementById('sendResultsBtn').addEventListener('click', () => {
        const data = {
            action: "llab_qr_results",
            test_id: testData.test_id,
            title: testData.title,
            total_questions: testData.questions.length,
            results: allResults
        };
        tg.sendData(JSON.stringify(data));
        tg.close();
    });

    // === INIT ===
    loadTestData();
});
