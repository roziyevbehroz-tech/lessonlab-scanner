// Telegram Web App init
const tg = window.Telegram.WebApp;
tg.expand(); // To'liq ekranga yoyish

// HTML Elementlar
const resultList = document.getElementById('results-list');
const correctCountEl = document.getElementById('correct-count');
const wrongCountEl = document.getElementById('wrong-count');
const totalScannedEl = document.getElementById('total-scanned');

// Kamera sozlamalari
let html5QrcodeScanner;
let scannedCodes = new Set(); // Qayta o'qimaslik uchun
let correctCount = 0;
let wrongCount = 0;

function onScanSuccess(decodedText, decodedResult) {
    if (scannedCodes.has(decodedText)) {
        return; // Allaqachon o'qilgan
    }

    scannedCodes.add(decodedText);

    // Ovozli signal (Bip)
    // new Audio('beep.mp3').play().catch(e => console.log(e)); 
    // Telegramda vibratsiya berish
    tg.HapticFeedback.impactOccurred('medium');

    // Natijani tahlil qilish (Hozircha oddiy simulyatsiya)
    // Haqiqiy hayotda: QR kodda {id: 1, javob: 'A'} bo'ladi
    // Biz uni to'g'ri javob bilan solishtiramiz.

    // Simulyatsiya: Agar kodda "A" harfi bo'lsa to'g'ri, yo'qsa xato
    const isCorrect = decodedText.includes("A") || Math.random() > 0.5;

    if (isCorrect) {
        correctCount++;
        correctCountEl.innerText = correctCount;
        tg.HapticFeedback.notificationOccurred('success');
    } else {
        wrongCount++;
        wrongCountEl.innerText = wrongCount;
        tg.HapticFeedback.notificationOccurred('error');
    }

    totalScannedEl.innerText = correctCount + wrongCount;

    // Ro'yxatga qo'shish
    const li = document.createElement('li');
    li.className = 'result-item';
    li.style.color = isCorrect ? '#81c784' : '#e57373';
    li.innerText = `O'quvchi: ${decodedText} - ${isCorrect ? 'To\'g\'ri' : 'Xato'}`;

    // Ro'yxat boshiga qo'shish
    resultList.insertBefore(li, resultList.firstChild);
}

function onScanFailure(error) {
    // Xatolik bo'lsa (o'qiy olmasa) shunchaki o'tkazib yuboramiz
    // console.warn(`Code scan error = ${error}`);
}

// Kamerani ishga tushirish (Orqa kamera majburiy)
function startScanner() {
    const readerElement = document.getElementById("reader");
    readerElement.innerHTML = ""; // Tozalash

    const html5Qrcode = new Html5Qrcode("reader");

    const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
    };

    // 1. Avval orqa kamerani so'raymiz
    html5Qrcode.start(
        { facingMode: "environment" }, // Orqa kamera
        config,
        onScanSuccess,
        onScanFailure
    ).catch(err => {
        // 2. Agar orqa kamera bo'lmasa (masalan noutbukda), oldi kamerani yoqamiz
        console.warn("Orqa kamera topilmadi, oldi kamera ishlatilmoqda...", err);
        html5Qrcode.start(
            { facingMode: "user" },
            config,
            onScanSuccess,
            onScanFailure
        ).catch(err2 => {
            readerElement.innerHTML = "Kamerani yoqib bo'lmadi. Ruxsat berilganini tekshiring.";
        });
    });
}

// Sahifa yuklanganda ishga tushamiz
document.addEventListener('DOMContentLoaded', () => {
    startScanner();
});

// Tugmalarga hodisalar
document.getElementById('next-btn').addEventListener('click', () => {
    // Keyingi savolga o'tish logikasi
    if (confirm("Keyingi savolga o'tasizmi?")) {
        scannedCodes.clear();
        resultList.innerHTML = '';
        correctCount = 0;
        wrongCount = 0;
        correctCountEl.innerText = '0';
        wrongCountEl.innerText = '0';
        totalScannedEl.innerText = '0';
        alert("Keyingi savolga o'tildi!");
    }
});

document.getElementById('finish-btn').addEventListener('click', () => {
    tg.close();
});

document.getElementById('finish-btn').addEventListener('click', () => {
    tg.close();
});

