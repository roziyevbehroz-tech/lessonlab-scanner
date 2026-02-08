
// Telegram WebApp obyektini olamiz
const tg = window.Telegram.WebApp;
tg.expand(); // Ilovani to'liq ekranga yoyish

// DOM elementlar
const video = document.getElementById('videoInput');
const canvas = document.getElementById('canvasOutput');
const loadingMsg = document.getElementById('loadingMessage');
const statsDiv = document.getElementById('scan-stats');
const resultsList = document.getElementById('results-list');
const correctCountEl = document.getElementById('correct-count');
const wrongCountEl = document.getElementById('wrong-count');
const totalScannedEl = document.getElementById('total-scanned');

let stream = null;
let streaming = false;
let videoWidth = 0;
let videoHeight = 0;
let cap = null;
let src = null;
let dst = null; // Kulrang tasvir
let gray = null;

// ArUco o'zgaruvchilari
let arucoDict = null;
let arucoParams = null;
let markerIds = null;
let markerCorners = null;
let rvecs = null;
let tvecs = null;

// Statistika
let scannedResults = {}; // {MarkerID: "A"} kabi saqlanadi
let correctCount = 0;
let wrongCount = 0;
let totalScanned = 0;

// OpenCV tayyor bo'lganda ishga tushadi
function onOpenCvReady() {
    console.log('OpenCV.js muvaffaqiyatli yuklandi!');
    loadingMsg.innerText = "OpenCV yuklandi. Kamera kutilmoqda...";
    startCamera();
}

function startCamera() {
    // Orqa kamerani (environment) so'raymiz
    const constraints = {
        audio: false,
        video: {
            facingMode: 'environment', // Orqa kamera
            width: { ideal: 640 }, // Kichikroq o'lcham tezlik uchun yaxshi
            height: { ideal: 480 }
        }
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(function (s) {
            stream = s;
            video.srcObject = stream;
            video.play();
        })
        .catch(function (err) {
            console.error("Kamerani ochishda xatolik: " + err);
            loadingMsg.innerText = "Xatolik: Kamera ruxsatini tekshiring! (HTTPS kerak)";
        });

    video.addEventListener('canplay', function (ev) {
        if (!streaming) {
            videoWidth = video.videoWidth;
            videoHeight = video.videoHeight;
            canvas.width = videoWidth;
            canvas.height = videoHeight;
            streaming = true;

            loadingMsg.style.display = "none"; // Loadingni yashirish
            startProcessing(); // Tahlilni boshlash
        }
    }, false);
}

function startProcessing() {
    // OpenCV obyektlarini yaratish
    cap = new cv.VideoCapture(video);
    src = new cv.Mat(videoHeight, videoWidth, cv.CV_8UC4);
    dst = new cv.Mat(videoHeight, videoWidth, cv.CV_8UC1); // Kulrang

    // ArUco obyektlari
    // DICT_4X4_50 lug'atini ishlatamiz (PDF generator bilan bir xil)
    arucoDict = new cv.aruco_Dictionary(cv.aruco.DICT_4X4_50);
    arucoParams = new cv.aruco_DetectorParameters();

    // Natijalar uchun
    markerIds = new cv.Mat();
    markerCorners = new cv.MatVector();
    rvecs = new cv.Mat();
    tvecs = new cv.Mat();

    // Loop
    requestAnimationFrame(processVideo);
}

function processVideo() {
    if (!streaming) return;

    try {
        cap.read(src); // Videodan kadr olish
        cv.cvtColor(src, dst, cv.COLOR_RGBA2GRAY); // Oq-qora qilish

        // Markerlarni qidirish
        cv.aruco.detectMarkers(dst, arucoDict, markerCorners, markerIds, arucoParams);

        // Agar marker topsa
        if (markerIds.rows > 0) {
            // Markerlarni chizish (yashil ramka)
            // (Afsuski js versiyada drawDetectedMarkers yo'q bo'lishi mumkin, qo'lda chizamiz)
            // cv.aruco.drawDetectedMarkers(src, markerCorners, markerIds);

            for (let i = 0; i < markerIds.rows; ++i) {
                let id = markerIds.data32S[i];
                let corners = markerCorners.get(i);

                // Burchaklarni olish
                // corners[0] = TopLeft, [1] = TopRight, [2] = BottomRight, [3] = BottomLeft
                let tl = { x: corners.data32F[0], y: corners.data32F[1] };
                let tr = { x: corners.data32F[2], y: corners.data32F[3] };
                let br = { x: corners.data32F[4], y: corners.data32F[5] };
                let bl = { x: corners.data32F[6], y: corners.data32F[7] };

                // Javobni aniqlash (Burilish asosida)
                // Plickers logikasi:
                // Eng yuqori nuqta qaysi burchak ekanligiga qarab javob chiqadi.
                // Lekin ArUco burchaklari tartibi o'zgarmaydi.
                // Masalan: Agar 'tl' (TopLeft) aslida eng pastda bo'lsa, demak kartochka 180 gradusga burilgan.

                let answer = detectAnswer(tl, tr, br, bl);

                // Ekranga chizish
                drawMarker(src, tl, tr, br, bl, id, answer);

                // Natijani saqlash
                saveResult(id, answer);
            }
        }

        // Natijani Canvasga chiqarish
        cv.imshow('canvasOutput', src);

        // Xotirani tozalash (juda muhim!)
        // Loop ichida Mat larni delete qilmaymiz, faqat qayta ishlatamiz.
        // Lekin markerCorners.delete() har safar kerak bo'lishi mumkin.
        // JS Garbage Collector ishlashi uchun.

        // markerCorners va markerIds ni tozalash kerak
        // Lekin 'src' ni saqlab qolamiz.

    } catch (err) {
        console.error(err);
    }

    requestAnimationFrame(processVideo);
}

// Javobni aniqlash (A, B, C, D)
function detectAnswer(tl, tr, br, bl) {
    // Y koordinatalarini solishtiramiz (qaysi biri eng tepada?)
    // Canvasda Y qancha kichik bo'lsa, shuncha tepada bo'ladi.

    let points = [
        { name: "A", y: tl.y }, // Normal holatda TL tepada -> A
        { name: "B", y: tr.y }, // 90 gradus o'ngga -> TR tepada -> B
        { name: "C", y: br.y }, // 180 gradus -> BR tepada -> C
        { name: "D", y: bl.y }  // 270 gradus -> BL tepada -> D
        // (Bu Plickers/Quizizz kartalariga qarab o'zgarishi mumkin, lekin hozircha standart taxmin)
    ];

    // Eng kichik Y (eng tepada) ni topamiz
    points.sort((a, b) => a.y - b.y);
    return points[0].name;
}

// Ekranga chizish (Yashil ramka va matn)
function drawMarker(mat, tl, tr, br, bl, id, ans) {
    // Chiziq chizish
    let color = new cv.Scalar(0, 255, 0, 255); // Yashil
    let thickness = 4;

    cv.line(mat, tl, tr, color, thickness);
    cv.line(mat, tr, br, color, thickness);
    cv.line(mat, br, bl, color, thickness);
    cv.line(mat, bl, tl, color, thickness);

    // ID va Javobni yozish
    let text = `ID:${id} Ans:${ans}`;
    let point = new cv.Point(tl.x, tl.y - 10);
    cv.putText(mat, text, point, cv.FONT_HERSHEY_SIMPLEX, 1.0, color, 2);
}

// Natijani saqlash
function saveResult(id, ans) {
    // Agar bu ID avval o'qilmagan bo'lsa yoki javob o'zgargan bo'lsa
    if (!scannedResults[id] || scannedResults[id] !== ans) {
        scannedResults[id] = ans;

        // Telegram Vibration
        if (tg.HapticFeedback) {
            tg.HapticFeedback.impactOccurred('medium');
        }

        updateUI();
    }
}

function updateUI() {
    totalScanned = Object.keys(scannedResults).length;
    // To'g'ri/Noto'g'ri ni hozircha bilmaymiz (Serverdan so'rash kerak).
    // Hozircha hammasini "Scanner" deb qo'shamiz.

    totalScannedEl.innerText = totalScanned;

    // Ro'yxatni yangilash
    resultsList.innerHTML = "";
    for (const [id, ans] of Object.entries(scannedResults)) {
        let li = document.createElement("li");
        li.className = "result-item";
        li.innerHTML = `<span>ID: ${id}</span> <strong>${ans}</strong>`;
        resultsList.appendChild(li); // Yangilari pastga
    }
}

// Xotirani tozalash (Sahifa yopilganda)
window.onunload = function () {
    src.delete(); dst.delete();
    arucoDict.delete(); arucoParams.delete();
    markerIds.delete(); markerCorners.delete();
};
