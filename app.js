
// ==========================================
// app.js - JS-ArUco Versiyasi (DOM Ready bilan)
// ==========================================

// Debug oynasi
let debugDiv = null;

function log(msg, isError = false) {
    console.log(msg);
    if (!debugDiv) {
        debugDiv = document.getElementById("debugConsole");
        if (!debugDiv) {
            debugDiv = document.createElement("div");
            debugDiv.id = "debugConsole";
            debugDiv.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100px; overflow-y:scroll; color:lime; background:rgba(0,0,0,0.8); z-index:99999; font-size:10px; pointer-events:none; padding:5px;";
            const container = document.querySelector('.camera-container');
            if (container) container.appendChild(debugDiv);
            else document.body.appendChild(debugDiv);
        }
    }
    const color = isError ? "red" : "lime";
    const time = new Date().toLocaleTimeString();
    debugDiv.innerHTML += `<div style="color:${color};">[${time}] ${msg}</div>`;
    debugDiv.scrollTop = debugDiv.scrollHeight;
}

window.onerror = function (msg, url, lineNo, columnNo, error) {
    log(`Error: ${msg} (${lineNo})`, true);
    return false;
};

// DOM Tayyor bo'lganda ishga tushadi
document.addEventListener('DOMContentLoaded', function () {
    log("DOM tayyor!");

    // Telegram Setup
    const tg = window.Telegram.WebApp;
    tg.expand();
    tg.ready();
    log("Telegram WebApp ready");

    // Elements
    const video = document.getElementById('videoInput');
    const canvas = document.getElementById('canvasOutput');
    const loadingMsg = document.getElementById('loadingMessage');
    const resultsList = document.getElementById('results-list');
    const totalScannedEl = document.getElementById('total-scanned');

    if (!video) { log("XATO: videoInput topilmadi!", true); return; }
    if (!canvas) { log("XATO: canvasOutput topilmadi!", true); return; }

    const context = canvas.getContext('2d');
    log("Canvas context olindi");

    // ArUco Detector
    let detector = null;
    let scannedResults = {};

    // Buttons
    const nextBtn = document.getElementById('next-question-btn');
    const finishBtn = document.getElementById('finish-test-btn');

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            log("Keyingi savol bosildi");
            tg.sendData(JSON.stringify({ action: "next_question" }));
            scannedResults = {};
            updateUI();
        });
    } else log("XATO: next-question-btn yo'q!", true);

    if (finishBtn) {
        finishBtn.addEventListener('click', () => {
            log("Tugatish bosildi");
            tg.sendData(JSON.stringify({ action: "finish_test" }));
            tg.close();
        });
    } else log("XATO: finish-test-btn yo'q!", true);

    // Start Camera
    function startCamera() {
        log("Kamera so'ralmoqda...");

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            log("XATO: getUserMedia qo'llab-quvvatlanmaydi!", true);
            loadingMsg.innerText = "Kamera qo'llab-quvvatlanmaydi";
            return;
        }

        navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: 'environment' }
        })
            .then(stream => {
                log("Kamera ruxsati berildi!");
                video.srcObject = stream;
                video.play();
            })
            .catch(err => {
                log("Kamera xatosi: " + err.name + " - " + err.message, true);
                // Fallback: oldi kamera
                navigator.mediaDevices.getUserMedia({ video: true, audio: false })
                    .then(stream => {
                        log("Oldi kamera ochildi");
                        video.srcObject = stream;
                        video.play();
                    })
                    .catch(e => {
                        log("Kamera umuman ochilmadi: " + e.message, true);
                        loadingMsg.innerText = "Kameraga ruxsat bering!";
                    });
            });
    }

    video.addEventListener('loadedmetadata', function () {
        log(`Video: ${video.videoWidth}x${video.videoHeight}`);
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        loadingMsg.style.display = 'none';

        // ArUco kutubxonasini tekshirish
        if (typeof AR === 'undefined' || typeof AR.Detector === 'undefined') {
            log("XATO: AR kutubxonasi yuklanmadi!", true);
            loadingMsg.style.display = 'block';
            loadingMsg.innerText = "ArUco kutubxonasi yuklanmadi!";
            return;
        }

        detector = new AR.Detector();
        log("ArUco Detector tayyor. Tahlil boshlandi...");

        requestAnimationFrame(tick);
    });

    function tick() {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            try {
                const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                const markers = detector.detect(imageData);

                drawMarkers(markers);
            } catch (e) {
                // Silent
            }
        }
        requestAnimationFrame(tick);
    }

    function drawMarkers(markers) {
        if (!markers || markers.length === 0) return;

        markers.forEach(marker => {
            drawPoly(marker.corners, "lime");

            const id = marker.id;
            const corners = marker.corners;

            // Eng tepada turgan burchakni topish
            let minY = Infinity;
            let minIndex = -1;

            for (let i = 0; i < 4; i++) {
                if (corners[i].y < minY) {
                    minY = corners[i].y;
                    minIndex = i;
                }
            }

            const answers = ["A", "B", "C", "D"];
            const ans = answers[minIndex] || "?";

            context.fillStyle = "lime";
            context.font = "bold 20px monospace";
            context.fillText(`ID:${id} (${ans})`, corners[0].x, corners[0].y - 10);

            saveResult(id, ans);
        });
    }

    function drawPoly(corners, color) {
        context.beginPath();
        context.lineWidth = 3;
        context.strokeStyle = color;

        context.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) {
            context.lineTo(corners[i].x, corners[i].y);
        }
        context.closePath();
        context.stroke();
    }

    function saveResult(id, ans) {
        if (!scannedResults[id] || scannedResults[id] !== ans) {
            scannedResults[id] = ans;
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
            updateUI();
        }
    }

    function updateUI() {
        totalScannedEl.innerText = Object.keys(scannedResults).length;
        resultsList.innerHTML = "";
        Object.keys(scannedResults).reverse().forEach(id => {
            let li = document.createElement("li");
            li.className = "result-item";
            li.innerHTML = `<span>ID: ${id}</span> <strong>${scannedResults[id]}</strong>`;
            resultsList.appendChild(li);
        });
    }

    // Start
    startCamera();
});
