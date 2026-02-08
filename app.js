
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
    var src = imageSrc.data, len = imageSrc.width * imageSrc.height, hist = [], threshold = 0, sum = 0, sumB = 0, wB = 0, wF = 0, max = 0, mu, medical, between, i;
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
    var src = imageSrc.data, dst = imageDst.data, height = imageSrc.height, width = imageSrc.width, heightMinus1 = height - 1, widthMinus1 = width - 1, size = kernelSize + kernelSize + 1, radius = kernelSize + 1, mult = CV.stackBoxBlurMult[kernelSize], shift = CV.stackBoxBlurShift[kernelSize], stack, stackStart, color, sum, pos, start, p, x, y, i;
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
    CV.grayscale(image, this.grey); CV.adaptiveThreshold(this.grey, this.thres, 2, 7); this.contours = CV.findContours(this.thres, this.binary); this.candidates = this.findCandidates(this.contours, image.width * 0.20, 0.05, 10); this.candidates = this.clockwiseCorners(this.candidates); this.candidates = this.notTooNear(this.candidates, 10); return this.findMarkers(this.grey, this.candidates, 49);
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
// APP LOGIC (Scanner)
// ==========================================

let debugDiv = null;
function log(msg, isError = false) {
    if (!debugDiv) { debugDiv = document.getElementById("debugConsole"); }
    if (debugDiv) {
        const color = isError ? "red" : "lime";
        const time = new Date().toLocaleTimeString();
        debugDiv.innerHTML += `<div style="color:${color};">[${time}] ${msg}</div>`;
        debugDiv.scrollTop = debugDiv.scrollHeight;
    }
}

document.addEventListener('DOMContentLoaded', function () {
    log("Scanner starting...");
    const tg = window.Telegram.WebApp;
    tg.expand(); tg.ready();

    const video = document.getElementById('videoInput');
    const canvas = document.getElementById('canvasOutput');
    const loadingMsg = document.getElementById('loadingMessage');
    const resultsList = document.getElementById('results-list');
    const totalScannedEl = document.getElementById('total-scanned');
    const context = canvas.getContext('2d');

    let detector = new AR.Detector();
    let scannedResults = {};

    const nextBtn = document.getElementById('next-question-btn');
    const finishBtn = document.getElementById('finish-test-btn');

    if (nextBtn) nextBtn.onclick = () => { tg.sendData(JSON.stringify({ action: "next_question" })); scannedResults = {}; updateUI(); };
    if (finishBtn) finishBtn.onclick = () => { tg.sendData(JSON.stringify({ action: "finish_test" })); tg.close(); };

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => { video.srcObject = s; video.play(); log("Camera active."); })
        .catch(e => { log("Camera error: " + e.message, true); });

    video.onloadedmetadata = () => {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        loadingMsg.style.display = 'none'; log("Detection loop started.");
        requestAnimationFrame(tick);
    };

    function tick() {
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const markers = detector.detect(context.getImageData(0, 0, canvas.width, canvas.height));
            markers.forEach(m => {
                const c = m.corners;
                context.strokeStyle = "lime"; context.lineWidth = 3; context.beginPath(); context.moveTo(c[0].x, c[0].y); c.forEach(p => context.lineTo(p.x, p.y)); context.closePath(); context.stroke();
                let minY = Infinity, idx = -1; c.forEach((p, i) => { if (p.y < minY) { minY = p.y; idx = i; } });
                const ans = ["A", "B", "C", "D"][idx] || "?";
                context.fillStyle = "lime"; context.font = "bold 20px monospace"; context.fillText(`ID:${m.id} (${ans})`, c[0].x, c[0].y - 10);
                if (!scannedResults[m.id] || scannedResults[m.id] !== ans) { scannedResults[m.id] = ans; if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium'); updateUI(); }
            });
        }
        requestAnimationFrame(tick);
    }

    function updateUI() {
        totalScannedEl.innerText = Object.keys(scannedResults).length;
        resultsList.innerHTML = "";
        Object.keys(scannedResults).reverse().forEach(id => {
            let li = document.createElement("li"); li.className = "result-item";
            li.innerHTML = `<span>ID: ${id}</span> <strong>${scannedResults[id]}</strong>`;
            resultsList.appendChild(li);
        });
    }
});
