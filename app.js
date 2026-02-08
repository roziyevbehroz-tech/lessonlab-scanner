
// ==========================================
// 1. GLOBAL DEBUG & SETUP (Eng boshida)
// ==========================================

// Debug oynasini darrov yaratamiz
const debugDiv = document.createElement("div");
debugDiv.id = "debugConsole";
debugDiv.style.cssText = "position:absolute; top:0; left:0; width:100%; height:150px; overflow-y:scroll; color:lime; background:rgba(0,0,0,0.8); z-index:99999; font-size:12px; pointer-events:none; font-family:monospace; padding:5px;";
document.body.appendChild(debugDiv);

function log(msg, isError = false) {
    console.log(msg);
    const color = isError ? "red" : "lime";
    // Vaqtni qo'shamiz
    const time = new Date().toLocaleTimeString();
    debugDiv.innerHTML += `<div style="color:${color}; border-bottom:1px solid #333;">[${time}] ${msg}</div>`;
    debugDiv.scrollTop = debugDiv.scrollHeight;
}

// Global xatolarni ushlash
window.onerror = function (msg, url, lineNo, columnNo, error) {
    log(`Global Error: ${msg} (Line: ${lineNo})`, true);
    return false;
};

log("App.js ishga tushdi...");

// Telegram WebApp
const tg = window.Telegram.WebApp;
tg.expand();
log("Telegram WebApp expanded.");

// ==========================================
// 2. DOM ELEMENTLAR & O'ZGARUVCHILAR
// ==========================================
const video = document.getElementById('videoInput');
const canvas = document.getElementById('canvasOutput');
const loadingMsg = document.getElementById('loadingMessage');
const resultsList = document.getElementById('results-list');
const totalScannedEl = document.getElementById('total-scanned');

// Buttons
const nextBtn = document.getElementById('next-question-btn');
const finishBtn = document.getElementById('finish-test-btn');

let stream = null;
let streaming = false;
let cap = null;
let src = null;
let dst = null;
let gray = null;

// ArUco
let arucoDict = null;
let arucoParams = null;
let markerIds = null;
let markerCorners = null;

let scannedResults = {};

// ==========================================
// 3. EVENT LISTENERS (Tugmalar ishlashi uchun)
// ==========================================
if (nextBtn) {
    nextBtn.addEventListener('click', () => {
        log("Keyingi savol tugmasi bosildi");
        tg.sendData(JSON.stringify({ action: "next_question" }));
        // Ehtimol bu yerni o'zida UI ni tozalash kerakdir?
        scannedResults = {};
        updateUI();
    });
} else {
    log("XATO: 'next-question-btn' topilmadi!", true);
}

if (finishBtn) {
    finishBtn.addEventListener('click', () => {
        log("Tugatish tugmasi bosildi");
        tg.sendData(JSON.stringify({ action: "finish_test" }));
        tg.close();
    });
} else {
    log("XATO: 'finish-test-btn' topilmadi!", true);
}

// ==========================================
// 4. OPENCV & CAMERA LOGIKASI
// ==========================================

// OpenCV tayyor bo'lganda chaqiriladi (index.html dagi onload dan)
function onOpenCvReady() {
    log('OpenCV.js yuklandi (onOpenCvReady)!');
    if (typeof cv === 'undefined') {
        log("XATO: 'cv' obyekti yo'q!", true);
        return;
    }

    // ArUco tekshiruvi
    try {
        // Ba'zi buildlarda cv.aruco bo'lmaydi.
        if (!cv.aruco) {
            log("XATO: cv.aruco moduli YO'Q! OpenCV noto'g'ri versiya.", true);
            loadingMsg.innerText = "Xato: OpenCV ArUco moduli yo'q!";
            return;
        }
        log("ArUco moduli bor ✅");
        startCamera();
    } catch (e) {
        log("ArUco tekshirishda xato: " + e.message, true);
    }
}

function startCamera() {
    log("Kamera so'ralmoqda...");
    const constraints = {
        audio: false,
        video: {
            facingMode: 'environment',
            width: { ideal: 640 },
            height: { ideal: 480 }
        }
    };

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        log("XATO: navigator.mediaDevices.getUserMedia qo'llab-quvvatlanmaydi (yoki HTTPS emas)!", true);
        loadingMsg.innerText = "Kameraga ruxsat yo'q (HTTPS kerak)";
        return;
    }

    navigator.mediaDevices.getUserMedia(constraints)
        .then(function (s) {
            log("Kamera oqimi olindi ✅");
            stream = s;
            video.srcObject = stream;
            video.play().catch(e => log("Video.play himoyasi: " + e.message, true));
        })
        .catch(function (err) {
            log("Orqa kamera xatosi: " + err.name, true);
            // Fallback: Oldi kamera
            log("Oldi kamerani sinaymiz...");
            navigator.mediaDevices.getUserMedia({ video: true, audio: false })
                .then(s => {
                    stream = s;
                    video.srcObject = stream;
                    video.play();
                    log("Oldi kamera ochildi");
                })
                .catch(e => {
                    log("Kamera umuman ochilmadi: " + e.message, true);
                    loadingMsg.innerText = "Kamera ochilmadi: " + e.message;
                });
        });

    video.addEventListener('canplay', function (ev) {
        if (!streaming) {
            log(`Video o'lchami: ${video.videoWidth}x${video.videoHeight}`);
            video.setAttribute('width', video.videoWidth);
            video.setAttribute('height', video.videoHeight);
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            streaming = true;
            loadingMsg.style.display = "none";

            startProcessing();
        }
    }, false);
}

function startProcessing() {
    try {
        log("OpenCV obyektlarini yaratish...");
        cap = new cv.VideoCapture(video);
        src = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC4);
        dst = new cv.Mat(video.videoHeight, video.videoWidth, cv.CV_8UC1);

        arucoDict = new cv.aruco_Dictionary(cv.aruco.DICT_4X4_50);
        arucoParams = new cv.aruco_DetectorParameters();
        markerIds = new cv.Mat();
        markerCorners = new cv.MatVector();

        log("Tahlil loopi boshlandi 🔄");
        requestAnimationFrame(processVideo);
    } catch (e) {
        log("startProcessing Xatosi: " + e.message, true);
    }
}

function processVideo() {
    if (!streaming) return;

    try {
        cap.read(src);
        cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY);

        // Markerlarni qidirish
        cv.aruco.detectMarkers(dst, arucoDict, markerCorners, markerIds, arucoParams);

        if (markerIds.rows > 0) {
            for (let i = 0; i < markerIds.rows; ++i) {
                let id = markerIds.data32S[i];
                let corners = markerCorners.get(i);

                let tl = { x: corners.data32F[0], y: corners.data32F[1] };
                let tr = { x: corners.data32F[2], y: corners.data32F[3] };
                let br = { x: corners.data32F[4], y: corners.data32F[5] };
                let bl = { x: corners.data32F[6], y: corners.data32F[7] };

                let answer = detectAnswer(tl, tr, br, bl);

                // Chizish
                drawMarker(src, tl, tr, br, bl, id, answer);

                // Natijani saqlash
                saveResult(id, answer);
            }
        }

        // Ekranga (Canvasga) chiqarish
        cv.imshow('canvasOutput', src);

    } catch (err) {
        // Har bir freymda xato chiqmasligi uchun logni kamaytirish mumkin
        // log("Loop Error: " + err.message, true);
    }

    requestAnimationFrame(processVideo);
}


function detectAnswer(tl, tr, br, bl) {
    let points = [
        { name: "A", y: tl.y },
        { name: "B", y: tr.y },
        { name: "C", y: br.y },
        { name: "D", y: bl.y }
    ];
    points.sort((a, b) => a.y - b.y);
    return points[0].name;
}

function drawMarker(mat, tl, tr, br, bl, id, ans) {
    let color = new cv.Scalar(0, 255, 0, 255);
    let thickness = 4;

    cv.line(mat, tl, tr, color, thickness);
    cv.line(mat, tr, br, color, thickness);
    cv.line(mat, br, bl, color, thickness);
    cv.line(mat, bl, tl, color, thickness);

    let text = `${id}:${ans}`;
    let point = new cv.Point(tl.x, tl.y - 10);
    cv.putText(mat, text, point, cv.FONT_HERSHEY_SIMPLEX, 1.0, color, 2);
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
    // Oxirgi qo'shilgan yuqorida tursin
    const keys = Object.keys(scannedResults).reverse();
    for (const id of keys) {
        let ans = scannedResults[id];
        let li = document.createElement("li");
        li.className = "result-item";
        li.innerHTML = `<span>ID: ${id}</span> <strong>${ans}</strong>`;
        resultsList.appendChild(li);
    }
}

// Memory Cleanup
window.onunload = function () {
    if (src) src.delete();
    if (dst) dst.delete();
    if (arucoDict) arucoDict.delete();
    if (arucoParams) arucoParams.delete();
    if (markerIds) markerIds.delete();
    if (markerCorners) markerCorners.delete();
};
