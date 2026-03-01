// Telegram WebApp ni initsializatsiya qilish
const tg = window.Telegram.WebApp;
tg.expand(); // Ekranni to'liq egallash
tg.ready();

let currentUserId = 7929157875; // Default for testing outside Telegram
if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
    currentUserId = tg.initDataUnsafe.user.id;
    const userinfo = document.getElementById('user-info');
    userinfo.innerText = `Salom, ${tg.initDataUnsafe.user.first_name}`;
}

// Global state
let selectedClassId = null;
let currentAssigningStudentId = null;
let port = null;
let reader = null;
let readLoopActive = false;

// Kesh uchun chart instansiyasi
let analyticsChartInstance = null;


// ─── TAB ALMASHTIRISH MANTIG'I (SPA Frontend) ───
function switchTab(tabId, title, navElement) {
    document.getElementById('header-title').innerText = title;

    const allPanes = document.querySelectorAll('.tab-pane');
    allPanes.forEach(pane => {
        pane.classList.remove('active');
    });

    document.getElementById(`tab-${tabId}`).classList.add('active');

    const allNavItems = document.querySelectorAll('.nav-item');
    allNavItems.forEach(item => {
        item.classList.remove('active');
    });

    navElement.classList.add('active');

    if (tg.HapticFeedback) {
        tg.HapticFeedback.selectionChanged();
    }

    // Load data if switching to specific tabs
    if (tabId === 'dashboard') {
        loadDashboardStats();
    } else if (tabId === 'classes') {
        loadClasses();
    }
}

// Initial load for the default active tab
document.addEventListener('DOMContentLoaded', () => {
    loadDashboardStats();
});


// ==========================================
// SUPABASE DATA LOADING
// ==========================================

async function loadDashboardStats() {
    try {
        const cached = localStorage.getItem('cache_dash_' + currentUserId);
        if (cached) {
            try {
                const c = JSON.parse(cached);
                if (c.c !== undefined) document.getElementById('dash-class-count').innerText = c.c;
                if (c.s !== undefined) document.getElementById('dash-student-count').innerText = c.s;
                if (c.recentHtml) document.getElementById('dash-recent-tests').innerHTML = c.recentHtml;
            } catch (e) { }
        }

        // 1. Class count
        const { count: classCount } = await supabaseClient.from('bot_classes').select('*', { count: 'exact', head: true }).eq('user_id', currentUserId);
        document.getElementById('dash-class-count').innerText = classCount || 0;

        // 2. Student count
        const { data: classes } = await supabaseClient.from('bot_classes').select('id').eq('user_id', currentUserId);
        let studentCount = 0;
        if (classes && classes.length > 0) {
            const classIds = classes.map(c => c.id);
            const { count: sCount } = await supabaseClient.from('bot_students').select('*', { count: 'exact', head: true }).in('class_id', classIds);
            studentCount = sCount || 0;
        }
        document.getElementById('dash-student-count').innerText = studentCount;

        // 3. Recent Sessions
        const listEl = document.getElementById('dash-recent-tests');
        const { data: sessions, error } = await supabaseClient
            .from('bot_group_sessions')
            .select('*')
            .eq('user_id', currentUserId)
            .order('created_at', { ascending: false })
            .limit(5);

        let recentHtml = '';
        let chartLabels = [];
        let chartData = [];

        if (error) {
            console.error("Sessions error:", error);
            recentHtml = '<p style="color:red; font-size:12px;">Xatolik yuz berdi</p>';
        } else if (!sessions || sessions.length === 0) {
            recentHtml = '<p style="color:var(--hint-color); font-size:13px; margin:0;">Hali o\'tkazilgan testlar yo\'q.</p>';
        } else {
            recentHtml = '<ul class="item-list" style="width: 100%;">';
            // Teskari tartibda (eng eskisi chart boshida chiqishi uchun)
            const chartSessions = [...sessions].reverse();

            chartSessions.forEach(s => {
                let pCount = 0;
                let avgPct = 0;
                try {
                    let sc = JSON.parse(s.scores || '{}');
                    let students = Object.keys(sc);
                    pCount = students.length;

                    if (pCount > 0) {
                        let totalPct = 0;
                        students.forEach(sid => {
                            let st = sc[sid];
                            if (st.total > 0) {
                                totalPct += (st.correct / st.total) * 100;
                            }
                        });
                        avgPct = Math.round(totalPct / pCount);
                    }
                } catch (e) { }

                let valDate = new Date(s.created_at);
                let shortDate = valDate.getDate() + '/' + (valDate.getMonth() + 1);

                chartLabels.push(shortDate);
                chartData.push(avgPct);
            });

            sessions.forEach(s => {
                let pCount = 0;
                try {
                    let sc = JSON.parse(s.scores || '{}');
                    pCount = Object.keys(sc).length;
                } catch (e) { }

                let dateStr = new Date(s.created_at).toLocaleDateString();
                let statusIcon = s.status === 'active' ? '🟢' : '⚫';
                let modeText = 'Guruh Testi';
                try {
                    let set = JSON.parse(s.settings || '{}');
                    if (set.mode === 'qr_scanner') modeText = 'QR Skaner';
                } catch (e) { }

                recentHtml += `<li style="flex-direction:row; padding: 10px;">
                                   <div>
                                       <strong>${statusIcon} ${modeText}</strong><br>
                                       <span style="font-size:12px; color:var(--hint-color);">${dateStr} • Qo'shilganlar: ${pCount} ta</span>
                                   </div>
                               </li>`;
            });
            recentHtml += '</ul>';
        }
        listEl.innerHTML = recentHtml;

        // CHIZMA YARATISH (CHART.JS)
        const ctx = document.getElementById('analyticsChart');
        if (ctx) {
            if (analyticsChartInstance) {
                analyticsChartInstance.destroy();
            }
            if (chartData.length > 0) {
                ctx.style.display = 'block';
                analyticsChartInstance = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: chartLabels,
                        datasets: [{
                            label: 'O\'rtacha natija (%)',
                            data: chartData,
                            borderColor: '#8b5cf6',
                            backgroundColor: 'rgba(139, 92, 246, 0.2)',
                            borderWidth: 2,
                            pointBackgroundColor: '#8b5cf6',
                            pointRadius: 4,
                            fill: true,
                            tension: 0.4
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        scales: {
                            y: { beginAtZero: true, max: 100 }
                        },
                        plugins: {
                            legend: { display: false }
                        }
                    }
                });
            } else {
                ctx.style.display = 'none';
            }
        }

        localStorage.setItem('cache_dash_' + currentUserId, JSON.stringify({
            c: classCount || 0,
            s: studentCount,
            recentHtml: recentHtml
        }));

    } catch (err) {
        console.error("Dashboard yuklashda xato:", err);
    }
}



async function loadClasses() {
    const listEl = document.getElementById('classes-list');

    const cachedHtml = localStorage.getItem('cache_classes_' + currentUserId);
    if (cachedHtml) {
        listEl.innerHTML = cachedHtml;
    } else {
        listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Sinflar yuklanmoqda...</p>';
    }

    try {
        const { data, error } = await supabaseClient
            .from('bot_classes')
            .select('*')
            .eq('user_id', currentUserId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Sizda hali sinflar yo\'q.</p>';
            return;
        }

        let html = '<ul class="item-list">';
        data.forEach(cls => {
            html += `<li style="cursor:pointer;" onclick="openClass(${cls.id}, '${cls.name}')">
                        <span>🏫 ${cls.name}</span>
                        <i class="fa-solid fa-chevron-right" style="color:var(--hint-color);"></i>
                     </li>`;
        });
        html += '</ul>';
        listEl.innerHTML = html;
        localStorage.setItem('cache_classes_' + currentUserId, html);

    } catch (err) {
        console.error("Sinflarni yuklashda xato:", err);
        if (!cachedHtml) {
            listEl.innerHTML = `<p style="color:red; font-size: 13px; text-align:center;">Xatolik yuz berdi. Pultni sozlaganmisiz?</p>`;
        }
    }
}

async function openClass(classId, className) {
    selectedClassId = classId;
    document.getElementById('classes-card').style.display = 'none';
    document.getElementById('students-view').style.display = 'block';
    document.getElementById('class-title-header').innerText = className;

    await loadStudents(classId);
}

function closeStudentsView() {
    selectedClassId = null;
    document.getElementById('classes-card').style.display = 'block';
    document.getElementById('students-view').style.display = 'none';
}

async function loadStudents(classId) {
    const listEl = document.getElementById('students-list');
    listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">O\'quvchilar yuklanmoqda...</p>';

    try {
        const { data, error } = await supabaseClient
            .from('bot_students')
            .select('*')
            .eq('class_id', classId)
            .order('student_id_in_class', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Sinfda o\'quvchilar yo\'q.</p>';
            return;
        }

        let html = '<ul class="item-list">';
        data.forEach(student => {
            const remoteText = student.remote_id
                ? `<span style="color:#10b981; font-size:12px; font-weight:600;"><i class="fa-solid fa-satellite-dish"></i> ${student.remote_id}</span>`
                : `<span style="color:#ef4444; font-size:12px;"><i class="fa-solid fa-triangle-exclamation"></i> Pult ulanmagan</span>`;

            html += `<li style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; flex-direction:column; gap:4px; flex:1;">
                            <span><b>${student.student_id_in_class}.</b> ${student.full_name}</span>
                            ${remoteText}
                        </div>
                        <div style="display:flex; gap:5px;">
                            <button class="btn-sm" style="background-color: var(--button-color); color: white; border-radius:8px; display:flex; align-items:center; justify-content:center; padding:10px;" onclick="openAssignRemoteModal(${student.id}, '${student.full_name}')">
                                <i class="fa-solid fa-link"></i>
                            </button>
                            <button class="btn-sm" style="background-color: #f59e0b; color: white; border-radius:8px; display:flex; align-items:center; justify-content:center; padding:10px;" onclick="openStudentAnalytics('${student.full_name}')">
                                <i class="fa-solid fa-chart-line"></i>
                            </button>
                        </div>
                     </li>`;
        });
        html += '</ul>';
        listEl.innerHTML = html;

    } catch (err) {
        console.error("O'quvchilarni yuklashda xato:", err);
        listEl.innerHTML = `<p style="color:red; font-size: 13px; text-align:center;">Xatolik: ${err.message}</p>`;
    }
}

// ==========================================
// CLASS CREATION LOGIC
// ==========================================

function openCreateClassModal() {
    document.getElementById('create-class-modal').style.display = 'flex';
    setTimeout(() => {
        document.getElementById('create-class-modal').style.opacity = '1';
    }, 10);
    document.getElementById('new-class-name').value = '';
    document.getElementById('new-class-students').value = '';
    document.getElementById('student-line-count').innerText = '0';
}

function closeCreateClassModal() {
    document.getElementById('create-class-modal').style.opacity = '0';
    setTimeout(() => {
        document.getElementById('create-class-modal').style.display = 'none';
        document.getElementById('btn-save-class').innerHTML = '<i class="fa-solid fa-save"></i> Saqlash';
        document.getElementById('btn-save-class').disabled = false;
    }, 300);
}

document.getElementById('new-class-students').addEventListener('input', function () {
    const lines = this.value.split('\n').filter(line => line.trim() !== '');
    document.getElementById('student-line-count').innerText = lines.length;
});

async function saveNewClass() {
    const className = document.getElementById('new-class-name').value.trim();
    const studentsText = document.getElementById('new-class-students').value;
    const studentNames = studentsText.split('\n').map(s => s.trim()).filter(s => s !== '');

    if (!className) {
        Swal.fire('Xatolik', 'Sinf nomini kiriting!', 'error');
        return;
    }
    if (studentNames.length === 0) {
        Swal.fire('Xatolik', 'Kamida 1 ta o\'quvchi ismini kiriting!', 'error');
        return;
    }

    const btn = document.getElementById('btn-save-class');
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saqlanmoqda...';
    btn.disabled = true;

    try {
        // 1. Insert class
        const { data: classData, error: classError } = await window.supabaseClient
            .from('bot_classes')
            .insert([{ user_id: currentUserId, name: className }])
            .select();

        if (classError) throw classError;
        const newClassId = classData[0].id;

        // 2. Insert students
        const studentInserts = studentNames.map((name, index) => ({
            class_id: newClassId,
            student_id_in_class: index + 1,
            full_name: name,
            remote_id: null
        }));

        const { error: studentsError } = await window.supabaseClient
            .from('bot_students')
            .insert(studentInserts);

        if (studentsError) throw studentsError;

        closeCreateClassModal();
        Swal.fire('Muvaffaqiyat!', 'Sinf va o\'quvchilar saqlandi.', 'success');

        // Refresh classes list
        loadClasses();
        loadDashboardStats(); // update counters

    } catch (err) {
        console.error("Sinf saqlashda xato:", err);
        Swal.fire('Xato', 'Sinfni saqlashda xatolik yuz berdi: ' + (err.message || JSON.stringify(err)), 'error');
        btn.innerHTML = '<i class="fa-solid fa-save"></i> Saqlash';
        btn.disabled = false;
    }
}


// ==========================================
// WEB SERIAL API (REMOTE ASSIGNMENT)
// ==========================================

function openAssignRemoteModal(studentId, studentName) {
    // Agar mobile bo'lsa ogohlantirish (Web सीरियल telefonda ishlamasa ham UI ko'rinishi mumkin)
    if (!navigator.serial) {
        Swal.fire({
            title: 'Qurilma mos emas',
            text: 'Pultlarni (Arduinoni) faqat Kompyuter brauzerida ulashingiz mumkin. Botdagi Pult menyusini kompyuterdan oching!',
            icon: 'warning'
        });
        return; // Modalni ochmaslik
    }

    currentAssigningStudentId = studentId;
    document.getElementById('remote-student-name').innerText = studentName;
    document.getElementById('remote-modal').style.display = 'flex';
    document.getElementById('listening-status').style.display = 'none';

    const connStatus = document.getElementById('arduino-assign-status');
    const btnConnect = document.getElementById('btnConnectArduino');

    if (port && port.readable) {
        connStatus.innerHTML = "🟢 <b>Avvaldan ulanilgan!</b> O'quvchi pultini bossin.";
        connStatus.style.background = "#d4edda";
        connStatus.style.color = "#155724";
        connStatus.style.borderLeft = "4px solid #c3e6cb";
        btnConnect.style.display = 'none';
        document.getElementById('listening-status').style.display = 'block';
        if (!readLoopActive) {
            readLoopActive = true;
            readSerialForAssignment();
        }
    } else {
        connStatus.innerHTML = "🟡 Arduinoga ulanilmagan. Tugmani bosing.";
        connStatus.style.background = "#fff3cd";
        connStatus.style.color = "#856404";
        connStatus.style.borderLeft = "4px solid #ffeeba";
        btnConnect.style.display = 'inline-block';
    }
}

function closeRemoteModal() {
    document.getElementById('remote-modal').style.display = 'none';
    currentAssigningStudentId = null;
    // Port ochiq qoladi, boshqa o'quvchiga darhol ulash imkoniyati
}

async function connectArduinoForAssignment() {
    try {
        port = await navigator.serial.requestPort();
        await port.open({ baudRate: 9600 });

        const connStatus = document.getElementById('arduino-assign-status');
        const btnConnect = document.getElementById('btnConnectArduino');

        connStatus.innerHTML = "🟢 <b>Ulandi!</b> Endi pultdagi biron tugmani bosing.";
        connStatus.style.background = "#d4edda";
        connStatus.style.color = "#155724";
        connStatus.style.borderLeft = "4px solid #c3e6cb";

        btnConnect.style.display = 'none';
        document.getElementById('listening-status').style.display = 'block';

        readLoopActive = true;
        readSerialForAssignment();

    } catch (err) {
        console.error("Arduino ulanishda xato:", err);
        Swal.fire('Ulanib bo\'lmadi', 'Port tanlash bekor qilindi yoki xato: ' + err.message, 'warning');
    }
}

async function readSerialForAssignment() {
    const textDecoder = new TextDecoderStream();
    const readableStreamClosed = port.readable.pipeTo(textDecoder.writable);
    reader = textDecoder.readable.getReader();

    let buffer = "";

    try {
        while (readLoopActive) {
            const { value, done } = await reader.read();
            if (done) break;

            if (value) {
                buffer += value;
                let lines = buffer.split('\n');
                buffer = lines.pop(); // Oxirgi chala qismini bufferda qoldirish

                for (let line of lines) {
                    processAssignmentSignal(line.trim());
                }
            }
        }
    } catch (error) {
        console.error("O'qish xatosi:", error);
        port = null;
    } finally {
        if (reader) reader.releaseLock();
    }
}

async function processAssignmentSignal(signalData) {
    if (!signalData) return;
    if (!currentAssigningStudentId) return; // Student tanlanmagan yoki modal yopiq

    // Expect: ID:105432,BTN:A
    console.log("Qabul qilindi:", signalData);

    let remoteId = null;
    const parts = signalData.split(',');
    parts.forEach(p => {
        if (p.startsWith('ID:')) remoteId = p.replace('ID:', '').trim();
    });

    if (remoteId) {
        // Pausing signal reading to prevent multiple identical clicks while saving
        const studentIdToSave = currentAssigningStudentId;
        currentAssigningStudentId = null;

        document.getElementById('listening-status').innerHTML = `<p style="color:#10b981; font-weight:bold; text-align:center;"><i class="fa-solid fa-check-circle"></i> ID: ${remoteId} olindi! Saqlanmoqda...</p>`;

        try {
            const { error } = await supabaseClient
                .from('bot_students')
                .update({ remote_id: remoteId })
                .eq('id', studentIdToSave);

            if (error) throw error;

            Swal.fire({
                title: 'Muvaffaqiyatli!',
                text: `Pult (${remoteId}) o'quvchiga biriktirildi.`,
                icon: 'success',
                timer: 2000,
                showConfirmButton: false
            });

            setTimeout(() => {
                closeRemoteModal();
                if (selectedClassId) loadStudents(selectedClassId);
            }, 1000);

        } catch (err) {
            console.error("Bazaga saqlashda xato:", err);
            Swal.fire('Saqlashda xato', err.message, 'error');
            currentAssigningStudentId = studentIdToSave; // Re-enable listening
        }
    }
}

// ==========================================
// STUDENT ANALYTICS MODAL
// ==========================================

async function openStudentAnalytics(studentName) {
    document.getElementById('analytics-student-name').innerText = studentName;
    document.getElementById('analytics-tests-count').innerText = "Yuklanmoqda...";
    document.getElementById('analytics-avg-score').innerText = "...";
    document.getElementById('analytics-history-list').innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Tarix yuklanmoqda...</p>';

    const modal = document.getElementById('analytics-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.style.opacity = '1', 10);

    try {
        const { data: sessions, error } = await supabaseClient
            .from('bot_group_sessions')
            .select('*')
            .eq('user_id', currentUserId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        let totalScore = 0;
        let participatedCount = 0;
        let historyHtml = '<ul class="item-list">';

        if (sessions) {
            sessions.forEach(s => {
                let scoresDict = {};
                try { scoresDict = JSON.parse(s.scores || '{}'); } catch (e) { }

                // If the student participated in this session
                if (scoresDict[studentName] !== undefined) {
                    let score = parseInt(scoresDict[studentName]);
                    totalScore += score;
                    participatedCount++;

                    let dateStr = new Date(s.created_at).toLocaleDateString();
                    historyHtml += `<li>
                                       <span><i class="fa-solid fa-file-signature"></i> Guruh Testi</span>
                                       <div style="display:flex; flex-direction:column; align-items:flex-end;">
                                           <span style="font-weight:bold; color:var(--button-color);">${score} ball</span>
                                           <span style="font-size:11px; color:var(--hint-color);">${dateStr}</span>
                                       </div>
                                   </li>`;
                }
            });
        }

        historyHtml += '</ul>';

        document.getElementById('analytics-tests-count').innerText = participatedCount;

        if (participatedCount > 0) {
            const avg = Math.round(totalScore / participatedCount);
            document.getElementById('analytics-avg-score').innerText = avg;
            document.getElementById('analytics-history-list').innerHTML = historyHtml;
        } else {
            document.getElementById('analytics-avg-score').innerText = '-';
            document.getElementById('analytics-history-list').innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">O\'quvchi hali birorta testda qatnashmagan.</p>';
        }

    } catch (err) {
        console.error("Analitika yuklashda xato:", err);
        document.getElementById('analytics-history-list').innerHTML = '<p style="color:red; font-size: 13px; text-align: center;">Xatolik yuz berdi!</p>';
    }
}

function closeStudentAnalytics() {
    const modal = document.getElementById('analytics-modal');
    modal.style.opacity = '0';
    setTimeout(() => modal.style.display = 'none', 300);
}

// ==========================================


// ==========================================
// ACTION MODAL (START TEST / DICT)
// ==========================================

function openActionModal(id, type) {
    document.getElementById('action-item-id').value = id;
    document.getElementById('action-item-type').value = type;

    const titleText = type === 'test' ? 'Testni Boshlash' : 'Lug\'atni Boshlash';
    document.getElementById('action-modal-title').innerText = titleText;

    const modal = document.getElementById('action-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.style.opacity = '1', 10);
}

function closeActionModal() {
    const modal = document.getElementById('action-modal');
    modal.style.opacity = '0';
    setTimeout(() => modal.style.display = 'none', 300);
}

function startAction(actionType) {
    const itemId = document.getElementById('action-item-id').value;
    const itemType = document.getElementById('action-item-type').value;

    closeActionModal();

    const payload = `${actionType}_${itemType}_${itemId}`;

    if (window.Telegram && window.Telegram.WebApp) {
        // Guruh va Ulashish yuborish turlari uchun chat tanlash (Inline Query) ochamiz
        if (actionType === 'group' || actionType === 'share') {
            if (window.Telegram.WebApp.switchInlineQuery) {
                window.Telegram.WebApp.switchInlineQuery(payload, ['groups', 'supergroups']);
            }
        } else {
            // QR, Pult va Private rejimlar uchun joriy chatga (botni o'ziga) inline query tashlaymiz
            // Ikkinchi argumentni bermasak, bu joriy chatga yozuvni tayyorlab beradi
            if (window.Telegram.WebApp.switchInlineQuery) {
                window.Telegram.WebApp.switchInlineQuery(payload);
            }
        }
    } else {
        // Fallback
        Swal.fire('Harakat Tanlandi', `Botga yuboriladigan buyruq: ${payload}`, 'info');
    }
}

// ==========================================
// TEST DETAILS & QUESTIONS LOGIC
// ==========================================
let currentTestId = null;

async function openTestDetailView(testId, testTitle) {
    currentTestId = testId;
    document.getElementById('tests-list').parentElement.style.display = 'none';
    document.getElementById('dicts-card').style.display = 'none';

    document.getElementById('test-detail-title').innerText = testTitle;
    document.getElementById('test-detail-view').style.display = 'block';

    await loadQuestions(testId);
}

function closeTestDetailView() {
    currentTestId = null;
    document.getElementById('test-detail-view').style.display = 'none';
    document.getElementById('tests-list').parentElement.style.display = 'block';
    document.getElementById('dicts-card').style.display = 'block';
}

async function loadQuestions(testId) {
    const listEl = document.getElementById('test-questions-list');
    listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Savollar yuklanmoqda...</p>';

    try {
        // Fetch questions
        const { data: questions, error: qError } = await supabaseClient
            .from('bot_questions')
            .select('*')
            .eq('test_id', testId)
            .order('id', { ascending: true });

        if (qError) throw qError;

        if (!questions || questions.length === 0) {
            listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Bu testda hali savollar yo\'q.</p>';
            return;
        }

        // Fetch options for these questions
        const qIds = questions.map(q => q.id);
        const { data: options, error: optError } = await supabaseClient
            .from('bot_options')
            .select('*')
            .in('question_id', qIds);

        if (optError) throw optError;

        let html = '<ul class="item-list">';
        questions.forEach((q, index) => {
            const qOpts = options.filter(o => o.question_id === q.id).sort((a, b) => a.id - b.id);
            let optsHtml = '<div style="display:flex; flex-direction:column; gap:4px; margin-top:8px; font-size:13px; color:var(--hint-color);">';

            qOpts.forEach((opt, i) => {
                const label = ['A', 'B', 'C', 'D'][i] || '?';
                const style = opt.is_correct ? 'color:#10b981; font-weight:bold;' : '';
                optsHtml += `<span style="${style}">${label}) ${opt.text} ${opt.is_correct ? '✓' : ''}</span>`;
            });
            optsHtml += '</div>';

            html += `<li>
                        <div style="flex:1;">
                            <span style="font-weight:bold; color:var(--text-color);">${index + 1}. ${q.text}</span>
                            ${optsHtml}
                        </div>
                     </li>`;
        });
        html += '</ul>';
        listEl.innerHTML = html;

    } catch (err) {
        console.error("Savollarni yuklashda xato:", err);
        listEl.innerHTML = `<p style="color:red; font-size: 13px; text-align:center;">Xatolik yuz berdi.</p>`;
    }
}

function openAddQuestionModal() {
    document.getElementById('question-text').value = '';
    document.getElementById('opt-a-text').value = '';
    document.getElementById('opt-b-text').value = '';
    document.getElementById('opt-c-text').value = '';
    document.getElementById('opt-d-text').value = '';
    document.getElementById('opt-a-radio').checked = true;

    const modal = document.getElementById('add-question-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.style.opacity = '1', 10);
}

function closeAddQuestionModal() {
    const modal = document.getElementById('add-question-modal');
    modal.style.opacity = '0';
    setTimeout(() => modal.style.display = 'none', 300);
}

async function submitQuestion() {
    if (!currentTestId) return;

    const text = document.getElementById('question-text').value.trim();
    const optA = document.getElementById('opt-a-text').value.trim();
    const optB = document.getElementById('opt-b-text').value.trim();
    const optC = document.getElementById('opt-c-text').value.trim();
    const optD = document.getElementById('opt-d-text').value.trim();
    const correctVal = document.querySelector('input[name="correct-option"]:checked').value; // A, B, C, D

    if (!text || !optA || !optB) {
        Swal.fire('Diqqat', 'Savol matni va kamida A va B variantlar kiritilishi shart', 'warning');
        return;
    }

    const btn = document.getElementById('btnSaveQuestion');
    btn.disabled = true;
    btn.innerHTML = 'Saqlanmoqda...';

    try {
        // 1. Insert Question
        const { data: qData, error: qErr } = await supabaseClient
            .from('bot_questions')
            .insert([{ test_id: currentTestId, text: text, hint: '' }])
            .select()
            .single();

        if (qErr) throw qErr;
        const newQId = qData.id;

        // 2. Insert Options
        let optionsToInsert = [
            { question_id: newQId, text: optA, is_correct: correctVal === 'A' },
            { question_id: newQId, text: optB, is_correct: correctVal === 'B' }
        ];
        if (optC) optionsToInsert.push({ question_id: newQId, text: optC, is_correct: correctVal === 'C' });
        if (optD) optionsToInsert.push({ question_id: newQId, text: optD, is_correct: correctVal === 'D' });

        const { error: optErr } = await supabaseClient.from('bot_options').insert(optionsToInsert);
        if (optErr) throw optErr;

        Swal.fire({ title: 'Saqlandi!', icon: 'success', timer: 1000, showConfirmButton: false });
        closeAddQuestionModal();
        loadQuestions(currentTestId);

    } catch (err) {
        console.error("Savol saqlashda xato:", err);
        Swal.fire('Xatolik', err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Saqlash';
    }
}

// ==========================================
// DICTIONARY DETAILS & WORDS LOGIC
// ==========================================
let currentDictId = null;

async function openDictDetailView(dictId, dictName) {
    currentDictId = dictId;
    document.getElementById('dicts-card').style.display = 'none';
    document.getElementById('tests-list').parentElement.style.display = 'none'; // hide tests card

    document.getElementById('dict-detail-title').innerText = dictName;
    document.getElementById('dict-detail-view').style.display = 'block';

    await loadWords(dictId);
}

function closeDictDetailView() {
    currentDictId = null;
    document.getElementById('dict-detail-view').style.display = 'none';
    document.getElementById('tests-list').parentElement.style.display = 'block';
    document.getElementById('dicts-card').style.display = 'block';
}

async function loadWords(dictId) {
    const listEl = document.getElementById('dict-words-list');
    listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">So\'zlar yuklanmoqda...</p>';

    try {
        const { data, error } = await supabaseClient
            .from('bot_dictionary_words')
            .select('*')
            .eq('dictionary_id', dictId)
            .order('id', { ascending: true });

        if (error) throw error;

        if (!data || data.length === 0) {
            listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Bu lug\'atda hali so\'zlar yo\'q.</p>';
            return;
        }

        let html = '<ul class="item-list">';
        data.forEach((w, index) => {
            html += `<li>
                        <div style="flex:1; display:flex; justify-content:space-between; align-items:center;">
                            <span style="font-weight:bold; color:var(--text-color);">${w.word}</span>
                            <span style="color:var(--button-color); font-size:14px;">${w.translation}</span>
                        </div>
                     </li>`;
        });
        html += '</ul>';
        listEl.innerHTML = html;

    } catch (err) {
        console.error("So'zlarni yuklashda xato:", err);
        listEl.innerHTML = `<p style="color:red; font-size: 13px; text-align:center;">Xatolik yuz berdi.</p>`;
    }
}

function openAddWordModal() {
    document.getElementById('word-term').value = '';
    document.getElementById('word-translation').value = '';

    const modal = document.getElementById('add-word-modal');
    modal.style.display = 'flex';
    setTimeout(() => modal.style.opacity = '1', 10);
}

function closeAddWordModal() {
    const modal = document.getElementById('add-word-modal');
    modal.style.opacity = '0';
    setTimeout(() => modal.style.display = 'none', 300);
}

async function submitWord() {
    if (!currentDictId) return;

    const word = document.getElementById('word-term').value.trim();
    const translation = document.getElementById('word-translation').value.trim();

    if (!word || !translation) {
        Swal.fire('Diqqat', 'Ikkala maydonni ham to\'ldiring', 'warning');
        return;
    }

    const btn = document.getElementById('btnSaveWord');
    btn.disabled = true;
    btn.innerHTML = 'Saqlanmoqda...';

    try {
        const { error } = await supabaseClient
            .from('bot_dictionary_words')
            .insert([{ dictionary_id: currentDictId, word: word, translation: translation }]);

        if (error) throw error;

        // Kichik, xalaqit bermaydigan notification
        const Toast = Swal.mixin({
            toast: true,
            position: 'top-end',
            showConfirmButton: false,
            timer: 1500,
            timerProgressBar: true
        });
        Toast.fire({ icon: 'success', title: 'Qo\'shildi' });

        // Modalni ochiq qoldirib, faqat inputlarni tozalash qulayroq (ko'p so'z qo'shish uchun)
        document.getElementById('word-term').value = '';
        document.getElementById('word-translation').value = '';
        document.getElementById('word-term').focus();

        loadWords(currentDictId); // Refresh list in background

    } catch (err) {
        console.error("So'z saqlashda xato:", err);
        Swal.fire('Xatolik', err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Saqlash';
    }
}
