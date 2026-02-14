// ==========================================
// INTERNAL JS-ARUCO LIBRARY (CV + AR)
// ==========================================

var CV = CV || {};
CV.Image = function (width, height, data) { this.width = width || 0; this.height = height || 0; this.data = data || []; };
CV.grayscale = function (imageSrc, imageDst) {
    var src = imageSrc.data, dst = imageDst.data, len = src.length, i = 0, j = 0;
    imageDst.width = imageSrc.width; imageDst.height = imageSrc.height; imageDst.data = [];
    for (; i < len; i += 4) { dst[j++] = (src[i] * 0.299 + src[i + 1] * 0.587 + src[i + 2] * 0.114 + 0.5) & 0xff; }
};
CV.threshold = function (imageSrc, imageDst, threshold) {
    var src = imageSrc.data, dst = imageDst.data, len = src.length, tab = [], i;
    imageDst.width = imageSrc.width; imageDst.height = imageSrc.height; imageDst.data = [];
    for (i = 0; i < 256; ++i) { tab[i] = i <= threshold ? 0 : 255; }
    for (i = 0; i < len; ++i) { dst[i] = tab[src[i]]; }
};
CV.adaptiveThreshold = function (imageSrc, imageDst, kernelSize, threshold) {
    var src = imageSrc.data, dst = imageDst.data, len = src.length, tab = [], i;
    imageDst.width = imageSrc.width; imageDst.height = imageSrc.height; imageDst.data = [];
    CV.stackBoxBlur(imageSrc, imageDst, kernelSize);
    for (i = 0; i < 768; ++i) { tab[i] = (i - 255 <= -threshold) ? 255 : 0; }
    for (i = 0; i < len; ++i) { dst[i] = tab[src[i] - dst[i] + 255]; }
};
CV.otsu = function (imageSrc) {
    var src = imageSrc.data, len = imageSrc.width * imageSrc.height, hist = [], threshold = 0, sum = 0, sumB = 0, wB = 0, wF = 0, max = 0, mu, between, i;
    for (i = 0; i < 256; ++i) { hist[i] = 0; }
    for (i = 0; i < len; ++i) { hist[src[i]]++; }
    for (i = 0; i < 256; ++i) { sum += i * hist[i]; }
    for (i = 0; i < 256; ++i) { wB += hist[i]; if (0 !== wB) { wF = len - wB; if (0 === wF) { break; } sumB += i * hist[i]; mu = (sumB / wB) - ((sum - sumB) / wF); between = wB * wF * mu * mu; if (between > max) { max = between; threshold = i; } } }
    return threshold;
};
CV.stackBoxBlurMult = [1, 171, 205, 293, 57, 373, 79, 137, 241, 27, 391, 357, 41, 19, 283, 265];
CV.stackBoxBlurShift = [0, 9, 10, 11, 9, 12, 10, 11, 12, 9, 13, 13, 10, 9, 13, 13];
CV.BlurStack = function () { this.color = 0; this.next = null; };
CV.stackBoxBlur = function (imageSrc, imageDst, kernelSize) {
    var src = imageSrc.data, dst = imageDst.data, height = imageSrc.height, width = imageSrc.width, heightMinus1 = height - 1, widthMinus1 = width - 1, size = kernelSize + kernelSize + 1, radius = kernelSize + 1, mult = CV.stackBoxBlurMult[kernelSize], shift = CV.stackBoxBlurShift[kernelSize], stack, stackStart, sum, pos, p, x, y, i;
    imageDst.width = width; imageDst.height = height; imageDst.data = [];
    stack = stackStart = new CV.BlurStack();
    for (i = 1; i < size; ++i) { stack = stack.next = new CV.BlurStack(); } stack.next = stackStart;
    pos = 0;
    for (y = 0; y < height; ++y) {
        sum = radius * src[pos]; stack = stackStart;
        for (i = 0; i < radius; ++i) { stack.color = src[pos]; stack = stack.next; }
        for (i = 1; i < radius; ++i) { stack.color = src[pos + (widthMinus1 < i ? widthMinus1 : i)]; sum += stack.color; stack = stack.next; }
        stack = stackStart;
        for (x = 0; x < width; ++x) { dst[pos++] = (sum * mult) >>> shift; p = x + radius; p = pos - x + (p < widthMinus1 ? p : widthMinus1); sum -= stack.color - src[p]; stack.color = src[p]; stack = stack.next; }
    }
    for (x = 0; x < width; ++x) {
        pos = x; sum = radius * dst[pos]; stack = stackStart;
        for (i = 0; i < radius; ++i) { stack.color = dst[pos]; stack = stack.next; }
        for (i = 1; i < radius; ++i) { stack.color = dst[pos + (heightMinus1 < i ? heightMinus1 : i) * width]; sum += stack.color; stack = stack.next; }
        stack = stackStart;
        for (y = 0; y < height; ++y) { dst[pos] = (sum * mult) >>> shift; p = y + radius; p = x + (p < heightMinus1 ? p : heightMinus1) * width; sum -= stack.color - dst[p]; stack.color = dst[p]; stack = stack.next; pos += width; }
    }
};
CV.findContours = function (imageSrc, binary) {
    var width = imageSrc.width, height = imageSrc.height, contours = [], src, deltas, pos, pix, nbd, outer, hole, i, j;
    src = []; for (i = 0, j = imageSrc.data.length; i < j; ++i) { src[i] = imageSrc.data[i]; }
    deltas = CV.neighborhoodDeltas(width + 2); pos = width + 3; nbd = 1;
    for (i = 0; i < height; ++i, pos += 2) { for (j = 0; j < width; ++j, ++pos) { pix = src[pos]; if (0 !== pix) { outer = hole = false; if (1 === pix && 0 === src[pos - 1]) { outer = true; } else if (pix >= 1 && 0 === src[pos + 1]) { hole = true; } if (outer || hole) { ++nbd; contours.push(CV.borderFollowing(src, pos, nbd, { x: j, y: i }, hole, deltas)); } } } }
    return contours;
};
CV.borderFollowing = function (src, pos, nbd, point, hole, deltas) {
    var contour = [], pos1, pos3, pos4, s, s_end, s_prev;
    contour.hole = hole; s = s_end = hole ? 0 : 4; do { s = (s - 1) & 7; pos1 = pos + deltas[s]; if (src[pos1] !== 0) { break; } } while (s !== s_end);
    if (s === s_end) { src[pos] = -nbd; contour.push({ x: point.x, y: point.y }); } else {
        pos3 = pos; s_prev = s ^ 4;
        while (true) {
            s_end = s; do { pos4 = pos3 + deltas[s]; if (src[pos4] !== 0) { break; } s = (s + 1) & 7; } while (s !== s_end); if ((s + 1) & 4) { src[pos3] = -nbd; } else if (src[pos3] === 1) { src[pos3] = nbd; } contour.push({ x: point.x, y: point.y }); if (pos4 === pos && pos3 === pos1) { break; }
            pos3 = pos4; s = (s + 4) & 7; point.x += (1 === s || 2 === s || 3 === s ? 1 : 5 === s || 6 === s || 7 === s ? -1 : 0); point.y += (7 === s || 0 === s || 1 === s ? -1 : 3 === s || 4 === s || 5 === s ? 1 : 0); s_prev = (s + 4) & 7;
        }
    } return contour;
};
CV.neighborhoodDeltas = function (width) { return [-width - 1, -width, -width + 1, 1, width + 1, width, width - 1, -1]; };
CV.approxPolyDP = function (contour, epsilon) {
    var dominated, dominated_i, p1, p2, px, dist, d_sq, len, i, j, k, slice = [];
    for (i = 0, len = contour.length; i < len; ++i) { slice.push(contour[i]); }
    while (true) { dominated_i = -1; dominated = 0; for (i = 0, len = slice.length; i < len; ++i) { p1 = slice[i]; p2 = slice[(i + 1) % len]; if ((d_sq = CV.distSq(p1, p2)) <= 4) { continue; } for (j = 2; j < len; ++j) { k = (i + j) % len; px = slice[k]; dist = CV.distToSegmentSq(px, p1, p2); if (dist < epsilon && dist > dominated) { dominated_i = k; dominated = dist; } } } if (dominated_i >= 0) { slice.splice(dominated_i, 1); } else { break; } }
    return slice;
};
CV.distSq = function (p1, p2) { var dx = p1.x - p2.x, dy = p1.y - p2.y; return dx * dx + dy * dy; };
CV.distToSegmentSq = function (p, p1, p2) { var dx = p2.x - p1.x, dy = p2.y - p1.y, d = dx * dx + dy * dy, t = d ? ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / d : 0; if (t < 0) { dx = p.x - p1.x; dy = p.y - p1.y; } else if (t > 1) { dx = p.x - p2.x; dy = p.y - p2.y; } else { dx = p.x - (p1.x + t * dx); dy = p.y - (p1.y + t * dy); } return dx * dx + dy * dy; };
CV.isContourConvex = function (contour) {
    var orientation = 0, convex = true, len = contour.length, i = 0, j = 0, cur_pt, prev_pt, dxdy0, dydx0, dx0, dy0, dx, dy;
    prev_pt = contour[len - 1]; cur_pt = contour[0]; dx0 = cur_pt.x - prev_pt.x; dy0 = cur_pt.y - prev_pt.y;
    for (; i < len; ++i) { j = (i + 1) % len; prev_pt = cur_pt; cur_pt = contour[j]; dx = cur_pt.x - prev_pt.x; dy = cur_pt.y - prev_pt.y; dxdy0 = dx * dy0; dydx0 = dy * dx0; orientation |= dxdy0 > dydx0 ? 1 : (dxdy0 < dydx0 ? 2 : 0); if (3 === orientation) { convex = false; break; } dx0 = dx; dy0 = dy; }
    return convex;
};
CV.perimeter = function (poly) { var len = poly.length, i = 0, j = len - 1, p = 0.0, dx, dy; for (; i < len; j = i++) { dx = poly[i].x - poly[j].x; dy = poly[i].y - poly[j].y; p += Math.sqrt(dx * dx + dy * dy); } return p; };
CV.minEdgeLength = function (poly) { var len = poly.length, i = 0, j = len - 1, min = Infinity, d, dx, dy; for (; i < len; j = i++) { dx = poly[i].x - poly[j].x; dy = poly[i].y - poly[j].y; d = dx * dx + dy * dy; if (d < min) { min = d; } } return Math.sqrt(min); };
CV.warp = function (imageSrc, imageDst, contour, warpSize) {
    var src = imageSrc.data, dst = imageDst.data, width = imageSrc.width, height = imageSrc.height, pos = 0, sx1, sx2, dx1, dx2, sy1, sy2, dy1, dy2, p1, p2, p3, p4, r, s, u, v, x, y, i, j;
    imageDst.width = warpSize; imageDst.height = warpSize; imageDst.data = []; sx1 = contour[0].x; sy1 = contour[0].y; sx2 = contour[1].x; sy2 = contour[1].y; dx1 = contour[3].x; dy1 = contour[3].y; dx2 = contour[2].x; dy2 = contour[2].y;
    for (i = 0; i < warpSize; ++i) { r = i / warpSize; s = 1.0 - r; p1 = sx1 * s + dx1 * r; p2 = sy1 * s + dy1 * r; p3 = sx2 * s + dx2 * r; p4 = sy2 * s + dy2 * r; for (j = 0; j < warpSize; ++j) { u = j / warpSize; v = 1.0 - u; x = (p1 * v + p3 * u + 0.5) | 0; y = (p2 * v + p4 * u + 0.5) | 0; dst[pos++] = src[y * width + x]; } }
};
CV.countNonZero = function (imageSrc, square) {
    var src = imageSrc.data, height = imageSrc.height, width = imageSrc.width, pos = square.x + square.y * width, span = width - square.width, cnt = 0, i, j;
    for (i = 0; i < square.height; ++i) { for (j = 0; j < square.width; ++j) { if (0 !== src[pos++]) { ++cnt; } } pos += span; }
    return cnt;
};

var AR = AR || {};
AR.Marker = function (id, corners) { this.id = id; this.corners = corners; };
AR.Detector = function () { this.grey = new CV.Image(); this.thres = new CV.Image(); this.homography = new CV.Image(); this.binary = []; this.contours = []; this.polys = []; this.candidates = []; };
AR.Detector.prototype.detect = function (image) {
    CV.grayscale(image, this.grey); CV.adaptiveThreshold(this.grey, this.thres, 2, 7); this.contours = CV.findContours(this.thres, this.binary); this.candidates = this.findCandidates(this.contours, image.width * 0.10, 0.05, 10); this.candidates = this.clockwiseCorners(this.candidates); this.candidates = this.notTooNear(this.candidates, 10); return this.findMarkers(this.grey, this.candidates, 49);
};
AR.Detector.prototype.findCandidates = function (contours, minSize, epsilon, minLength) {
    var candidates = [], len = contours.length, contour, poly, i; this.polys = [];
    for (i = 0; i < len; ++i) { contour = contours[i]; if (contour.length >= minSize) { poly = CV.approxPolyDP(contour, contour.length * epsilon); this.polys.push(poly); if ((4 === poly.length) && (CV.isContourConvex(poly))) { if (CV.minEdgeLength(poly) >= minLength) { candidates.push(poly); } } } }
    return candidates;
};
AR.Detector.prototype.clockwiseCorners = function (candidates) {
    var len = candidates.length, dx1, dx2, dy1, dy2, swap, i;
    for (i = 0; i < len; ++i) { dx1 = candidates[i][1].x - candidates[i][0].x; dy1 = candidates[i][1].y - candidates[i][0].y; dx2 = candidates[i][2].x - candidates[i][0].x; dy2 = candidates[i][2].y - candidates[i][0].y; if ((dx1 * dy2 - dy1 * dx2) < 0) { swap = candidates[i][1]; candidates[i][1] = candidates[i][3]; candidates[i][3] = swap; } }
    return candidates;
};
AR.Detector.prototype.notTooNear = function (candidates, minDist) {
    var notTooNear = [], len = candidates.length, dist, dx, dy, i, j, k;
    for (i = 0; i < len; ++i) { for (j = i + 1; j < len; ++j) { dist = 0; for (k = 0; k < 4; ++k) { dx = candidates[i][k].x - candidates[j][k].x; dy = candidates[i][k].y - candidates[j][k].y; dist += dx * dx + dy * dy; } if ((dist / 4) < (minDist * minDist)) { if (CV.perimeter(candidates[i]) < CV.perimeter(candidates[j])) { candidates[i].tooNear = true; } else { candidates[j].tooNear = true; } } } }
    for (i = 0; i < len; ++i) { if (!candidates[i].tooNear) { notTooNear.push(candidates[i]); } }
    return notTooNear;
};
AR.Detector.prototype.findMarkers = function (imageSrc, candidates, warpSize) {
    var markers = [], len = candidates.length, candidate, marker, i;
    for (i = 0; i < len; ++i) { candidate = candidates[i]; CV.warp(imageSrc, this.homography, candidate, warpSize); CV.threshold(this.homography, this.homography, CV.otsu(this.homography)); marker = this.getMarker(this.homography, candidate); if (marker) { markers.push(marker); } }
    return markers;
};
AR.Detector.prototype.getMarker = function (imageSrc, candidate) {
    var width = (imageSrc.width / 7) >>> 0, minZero = (width * width) >> 1, bits = [], rotations = [], distances = [], square, pair, inc, i, j;
    for (i = 0; i < 7; ++i) { inc = (0 === i || 6 === i) ? 1 : 6; for (j = 0; j < 7; j += inc) { square = { x: j * width, y: i * width, width: width, height: width }; if (CV.countNonZero(imageSrc, square) > minZero) { return null; } } }
    for (i = 0; i < 5; ++i) { bits[i] = []; for (j = 0; j < 5; ++j) { square = { x: (j + 1) * width, y: (i + 1) * width, width: width, height: width }; bits[i][j] = CV.countNonZero(imageSrc, square) > minZero ? 1 : 0; } }
    rotations[0] = bits; distances[0] = this.hammingDistance(rotations[0]); pair = { first: distances[0], second: 0 };
    for (i = 1; i < 4; ++i) { rotations[i] = this.rotate(rotations[i - 1]); distances[i] = this.hammingDistance(rotations[i]); if (distances[i] < pair.first) { pair.first = distances[i]; pair.second = i; } }
    if (0 !== pair.first) { return null; }
    return new AR.Marker(this.mat2id(rotations[pair.second]), this.rotate2(candidate, 4 - pair.second));
};
AR.Detector.prototype.hammingDistance = function (bits) {
    var ids = [[1, 0, 0, 0, 0], [1, 0, 1, 1, 1], [0, 1, 0, 0, 1], [0, 1, 1, 1, 0]], dist = 0, sum, minSum, i, j, k;
    for (i = 0; i < 5; ++i) { minSum = Infinity; for (j = 0; j < 4; ++j) { sum = 0; for (k = 0; k < 5; ++k) { sum += bits[i][k] === ids[j][k] ? 0 : 1; } if (sum < minSum) { minSum = sum; } } dist += minSum; } return dist;
};
AR.Detector.prototype.mat2id = function (bits) { var id = 0, i; for (i = 0; i < 5; ++i) { id <<= 1; id |= bits[i][1]; id <<= 1; id |= bits[i][3]; } return id; };
AR.Detector.prototype.rotate = function (src) { var dst = [], len = src.length, i, j; for (i = 0; i < len; ++i) { dst[i] = []; for (j = 0; j < src[i].length; ++j) { dst[i][j] = src[src[i].length - j - 1][i]; } } return dst; };
AR.Detector.prototype.rotate2 = function (src, rotation) { var dst = [], len = src.length, i; for (i = 0; i < len; ++i) { dst[i] = src[(rotation + i) % len]; } return dst; };


// ==========================================
// SCANNER APP — SMART TESTER BOT
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
        const studentIdx = markerId; // ArUco marker 0 = student 1, etc.
        const student = testData.students.find(s => s.id === studentIdx + 1);
        return student ? student.name : `#${studentIdx + 1}`;
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
        currentQuestion = idx;

        // Save previous results
        if (Object.keys(currentScanResults).length > 0) {
            allResults[currentQuestion] = { ...currentScanResults };
        }

        // Load existing results for this question
        currentScanResults = allResults[idx] || {};
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
            loadingMsg.textContent = "Kamera ruxsati berilmadi!";
            return;
        }

        async function startCamera(deviceId) {
            if (currentStream) currentStream.getTracks().forEach(t => t.stop());
            const constraints = {
                audio: false,
                video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'environment' }
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
                    loadingMsg.textContent = "Kamera ochilmadi!";
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

        // Video ready
        video.onloadedmetadata = () => {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            if (!isProcessing) {
                isProcessing = true;
                requestAnimationFrame(tick);
            }
        };

        // === MAIN DETECTION LOOP ===
        function tick() {
            if (video.readyState === video.HAVE_ENOUGH_DATA) {
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                try {
                    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                    const markers = detector.detect(imageData);
                    const q = testData.questions[currentQuestion];
                    const correctIdx = q.correct;

                    markers.forEach(m => {
                        const c = m.corners;
                        const studentId = m.id + 1;

                        // Detect answer from orientation
                        let minY = Infinity, topIdx = -1;
                        c.forEach((p, i) => { if (p.y < minY) { minY = p.y; topIdx = i; } });
                        const currentAns = ANSWER_LETTERS[topIdx] || "?";
                        const answerIdx = topIdx;

                        // Lock-in buffer
                        if (!frameBuffers[studentId]) frameBuffers[studentId] = [];
                        frameBuffers[studentId].push(currentAns);
                        if (frameBuffers[studentId].length > BUFFER_SIZE) frameBuffers[studentId].shift();

                        const isStable = frameBuffers[studentId].length >= BUFFER_SIZE &&
                            frameBuffers[studentId].every(a => a === currentAns);

                        if (isStable) {
                            const isCorrect = (answerIdx === correctIdx);
                            drawMarkerBox(c, isCorrect, studentId, currentAns);

                            if (!currentScanResults[studentId] || currentScanResults[studentId].answer !== currentAns) {
                                currentScanResults[studentId] = {
                                    answer: currentAns,
                                    isCorrect: isCorrect,
                                    name: getStudentName(m.id)
                                };
                                if (tg.HapticFeedback) {
                                    tg.HapticFeedback.notificationOccurred(isCorrect ? 'success' : 'error');
                                }
                                updateUI();
                            }
                        } else {
                            drawMarkerBox(c, null, studentId, currentAns);
                        }
                    });
                } catch (e) { /* silent */ }
            }
            requestAnimationFrame(tick);
        }

        function drawMarkerBox(corners, isCorrect, id, ans) {
            const name = getStudentName(id - 1);
            let color = "#888888";
            let label = `${name}: ?`;

            if (isCorrect === true) { color = "#00ff00"; label = `${name}: ${ans} ✓`; }
            else if (isCorrect === false) { color = "#ff4444"; label = `${name}: ${ans} ✗`; }
            else { label = `${name}: ${ans} ...`; }

            context.strokeStyle = color;
            context.lineWidth = 4;
            context.beginPath();
            context.moveTo(corners[0].x, corners[0].y);
            corners.forEach(p => context.lineTo(p.x, p.y));
            context.closePath();
            context.stroke();

            context.fillStyle = isCorrect === null ? "rgba(128,128,128,0.2)" :
                (isCorrect ? "rgba(0,255,0,0.15)" : "rgba(255,0,0,0.15)");
            context.fill();

            context.fillStyle = color;
            context.font = "bold 18px Arial";
            const textWidth = context.measureText(label).width;
            context.fillRect(corners[0].x, corners[0].y - 30, textWidth + 10, 26);
            context.fillStyle = "#000";
            context.fillText(label, corners[0].x + 5, corners[0].y - 10);
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
        // Save current question results
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

        // Sort by correct answers
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
