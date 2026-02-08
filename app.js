
// ==========================================
// app.js - JS-ArUco Versiyasi (Engil & Tez)
// ==========================================

const debugDiv = document.getElementById("debugConsole") || document.createElement("div");
if (!document.getElementById("debugConsole")) {
    debugDiv.id = "debugConsole";
    debugDiv.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100px; overflow-y:scroll; color:lime; background:rgba(0,0,0,0.8); z-index:99999; font-size:10px; pointer-events:none; padding:5px;";
    document.querySelector('.camera-container').appendChild(debugDiv);
}

function log(msg, isError = false) {
    console.log(msg);
    const color = isError ? "red" : "lime";
    const time = new Date().toLocaleTimeString();
    debugDiv.innerHTML += `<div style="color:${color}; border-bottom:1px solid #333;">[${time}] ${msg}</div>`;
    debugDiv.scrollTop = debugDiv.scrollHeight;
}

window.onerror = function (msg, url, lineNo, columnNo, error) {
    log(`Global Error: ${msg} (${lineNo})`, true);
    return false;
};

log("Skaner ishga tushirildi...");

// Telegram Setup
const tg = window.Telegram.WebApp;
tg.expand();
tg.ready();

// Elements
const video = document.getElementById('videoInput');
const canvas = document.getElementById('canvasOutput');
const context = canvas.getContext('2d');
const loadingMsg = document.getElementById('loadingMessage');
const resultsList = document.getElementById('results-list');
const totalScannedEl = document.getElementById('total-scanned');

// ArUco Detector
let detector = null;

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
} else log("XATO: 'next-question-btn' yo'q!", true);

if (finishBtn) {
    finishBtn.addEventListener('click', () => {
        log("Tugatish bosildi");
        tg.sendData(JSON.stringify({ action: "finish_test" }));
        tg.close();
    });
} else log("XATO: 'finish-test-btn' yo'q!", true);

// Start Camera
function startCamera() {
    log("Kamera so'ralmoqda...");
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
            log("Kamera xatosi: " + err.name, true);
            loadingMsg.innerText = "Kameraga ruxsat bering!";
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
        return;
    }

    detector = new AR.Detector();
    log("ArUco Detector tayyor. Tahlil boshlandi...");

    requestAnimationFrame(tick);
});

let scannedResults = {};

function tick() {
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
        // Rasmni canvasga chizish
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        // Markerlarni aniqlash
        try {
            // getImageData optimallash mumkin, lekin hozircha to'liq
            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
            const markers = detector.detect(imageData);

            drawMarkers(markers);
        } catch (e) {
            // log("Detect Xatosi: " + e.message, true);
        }
    }
    requestAnimationFrame(tick);
}

function drawMarkers(markers) {
    if (!markers || markers.length === 0) return;

    markers.forEach(marker => {
        // Chegaralarni chizish
        drawPoly(marker.corners, "lime");

        // ID va burilishni aniqlash
        const id = marker.id;

        // JS-ArUco da corners tartibi:
        // [0]=TopLeft, [1]=TopRight, [2]=BottomRight, [3]=BottomLeft (Ideal holda)
        // Lekin burilganda ular aylanadi.
        // Bizga markerning "haqiqiy" tepasi kerak emas, balki
        // "Sahifaga nisbatan" qaysi burchagi tepada ekanligini topishimiz kerak.

        // Burchak koordinatalari
        const corners = marker.corners;
        // corners array of {x,y}

        // Bu kutubxona ID ni to'g'ri topadi, lekin rotatsiyani unchalik emas.
        // Rotatsiya: Hamming distance orqali topilgan eng yaxshi moslik.
        // Marker obyektida 'rotation' polesi bo'lmasligi mumkin (eski versiya).
        // Lekin 'corners' to'g'ri aylantirilgan bo'ladi (shunday umid qilamiz).

        // Agar corners[0] eng tepada bo'lsa -> A
        // corners[1] eng tepada bo'lsa -> B 

        // Keling, oddiy logika qilamiz:
        // Markerning markazini topamiz
        // Va har bir burchakni tekshiramiz.

        // Yo'q, oddiyroq:
        // Eng kichik Y ga ega burchakni topamiz.
        // U index 0 bo'lsa -> A, 1 -> B, 2 -> C, 3 -> D.
        // (Taxminiy logika, Plickers kabi).

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

        // Matn yozish
        context.lineWidth = 3;
        context.strokeStyle = "lime";
        context.stroke();

        context.fillStyle = "lime";
        context.font = "20px monospace";
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
