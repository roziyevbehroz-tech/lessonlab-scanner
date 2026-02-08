
// Telegram WebApp obyektini olamiz
const tg = window.Telegram.WebApp;
tg.expand(); // Ilovani to'liq ekranga yoyish

// DOM elementlar
const video = document.getElementById('videoInput');
const canvas = document.getElementById('canvasOutput');
const loadingMsg = document.getElementById('loadingMessage');
const resultsList = document.getElementById('results-list');
const totalScannedEl = document.getElementById('total-scanned');

let stream = null;
let streaming = false;
let videoWidth = 0;
let videoHeight = 0;
let cap = null;
let src = null;
let dst = null;
let gray = null;

// ArUco o'zgaruvchilari
let arucoDict = null;
let arucoParams = null;
let markerIds = null;
let markerCorners = null;

// Statistika
let scannedResults = {};

// DEBUG FUNKSIYALARI (Ekranga xato chiqarish uchun)
function createDebugUI() {
    let d = document.getElementById("debugConsole");
    if (!d) {
        d = document.createElement("div");
        d.id = "debugConsole";
        d.style.cssText = "position:absolute; top:0; left:0; width:100%; max-height:150px; overflow-y:scroll; color:lime; background:rgba(0,0,0,0.8); z-index:99999; font-size:10px; pointer-events:none; font-family:monospace;";
        document.body.appendChild(d);
    }
    return d;
}

function logDebug(msg, isError = false) {
    console.log(msg);
    const d = createDebugUI();
    const color = isError ? "red" : "lime";
    d.innerHTML += `<div style="color:${color}; border-bottom:1px solid #333;">${msg}</div>`;
    d.scrollTop = d.scrollHeight;
}

window.onerror = function (msg, url, lineNo, columnNo, error) {
    logDebug("Global Error: " + msg + " line:" + lineNo, true);
    return false;
};

// OpenCV tayyor bo'lganda ishga tushadi
function onOpenCvReady() {
    logDebug('OpenCV.js muvaffaqiyatli yuklandi!');
    loadingMsg.innerText = "OpenCV yuklandi. Kamera kutilmoqda...";

    // ArUco borligini tekshirish
    if (typeof cv === 'undefined') {
        logDebug("XATOLIK: cv obyekti mavjud emas!", true);
        return;
    }

    // ArUco moduli tekshiruvi
    // Ba'zi versiyalarda cv.aruco bo'ladi, ba'zilarida yo'q.
    try {
        if (!cv.aruco) {
            logDebug("DIQQAT: cv.aruco topilmadi! Standart opencv.js da ArUco bo'lmasligi mumkin.", true);
            logDebug("Iltimos, index.html da ArUco qo'shilgan OpenCV versiyasini ishlating.", true);
            // Baribir davom etib ko'ramiz, balki boshqa joydadir
        } else {
            logDebug("ArUco moduli topildi!");
        }
    } catch (e) {
        logDebug("Check error: " + e.message, true);
    }

    startCamera();
}

function startCamera() {
    logDebug("Kamera so'ralmoqda (environment)...");

    const constraints = {
        audio: false,
        video: {
            facingMode: 'environment', // Orqa kamera
            width: { ideal: 640 },
            height: { ideal: 480 }
        }
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(function (s) {
            stream = s;
            video.srcObject = stream;
            video.play();
            logDebug("Kamera ruxsati berildi!");
        })
        .catch(function (err) {
            logDebug("Kamera xatosi: " + err.name + ": " + err.message, true);
            loadingMsg.innerText = "Xato: Kamera ochilmadi (" + err.name + ")";

            // Agar environment bo'lmasa, user (oldi) kamerani sinab ko'ramiz
            logDebug("Oldi kamerani sinab ko'ramiz...");
            navigator.mediaDevices.getUserMedia({ video: true, audio: false })
                .then(function (s) {
                    stream = s;
                    video.srcObject = stream;
                    video.play();
                    logDebug("Oldi kamera ochildi!");
                })
                .catch(e => logDebug("Oldi kamera ham ochilmadi: " + e.message, true));
        });

    video.addEventListener('canplay', function (ev) {
        if (!streaming) {
            logDebug("Video o'lchami olindi: " + video.videoWidth + "x" + video.videoHeight);
            videoWidth = video.videoWidth;
            videoHeight = video.videoHeight;
            canvas.width = videoWidth;
            canvas.height = videoHeight;
            streaming = true;

            loadingMsg.style.display = "none";
            startProcessing();
        }
    }, false);
}

function startProcessing() {
    try {
        logDebug("OpenCV obyektlari yaratilmoqda...");
        cap = new cv.VideoCapture(video);
        src = new cv.Mat(videoHeight, videoWidth, cv.CV_8UC4);
        dst = new cv.Mat(videoHeight, videoWidth, cv.CV_8UC1);

        // Agar ArUco bo'lmasa, bu yerda xato beradi
        if (cv.aruco) {
            arucoDict = new cv.aruco_Dictionary(cv.aruco.DICT_4X4_50);
            arucoParams = new cv.aruco_DetectorParameters();
            markerIds = new cv.Mat();
            markerCorners = new cv.MatVector();
        } else {
            throw new Error("ArUco moduli yo'q. Iltimos OpenCV ni tekshiring.");
        }

        logDebug("Tahlil boshlandi!");
        requestAnimationFrame(processVideo);

    } catch (err) {
        logDebug("startProcessing error: " + err.message, true);
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
            logDebug("Marker topildi! Soni: " + markerIds.rows);

            for (let i = 0; i < markerIds.rows; ++i) {
                let id = markerIds.data32S[i];
                let corners = markerCorners.get(i);

                let tl = { x: corners.data32F[0], y: corners.data32F[1] };
                let tr = { x: corners.data32F[2], y: corners.data32F[3] };
                let br = { x: corners.data32F[4], y: corners.data32F[5] };
                let bl = { x: corners.data32F[6], y: corners.data32F[7] };

                let answer = detectAnswer(tl, tr, br, bl);

                drawMarker(src, tl, tr, br, bl, id, answer);
                saveResult(id, answer);
            }
        }

        cv.imshow('canvasOutput', src);

    } catch (err) {
        logDebug("Loop error: " + err.message, true);
        // Xato bo'lsa ham davom etsin, balki keyingi kadr o'xshar
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

    let text = `ID:${id} Ans:${ans}`;
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
    for (const [id, ans] of Object.entries(scannedResults)) {
        let li = document.createElement("li");
        li.className = "result-item";
        li.innerHTML = `<span>ID: ${id}</span> <strong>${ans}</strong>`;
        resultsList.appendChild(li);
    }
}

window.onunload = function () {
    if (src) src.delete();
    if (dst) dst.delete();
    if (arucoDict) arucoDict.delete();
    if (arucoParams) arucoParams.delete();
    if (markerIds) markerIds.delete();
    if (markerCorners) markerCorners.delete();
};
