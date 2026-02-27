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
    } else if (tabId === 'tests') {
        loadTests();
        loadDictionaries();
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
        // Test count
        const { count: testCount } = await supabaseClient.from('bot_tests').select('*', { count: 'exact', head: true }).eq('user_id', currentUserId);
        document.getElementById('dash-test-count').innerText = testCount || 0;

        // Dict count
        const { count: dictCount } = await supabaseClient.from('bot_dictionaries').select('*', { count: 'exact', head: true }).eq('user_id', currentUserId);
        document.getElementById('dash-dict-count').innerText = dictCount || 0;

        // Class count
        const { count: classCount } = await supabaseClient.from('bot_classes').select('*', { count: 'exact', head: true }).eq('user_id', currentUserId);
        document.getElementById('dash-class-count').innerText = classCount || 0;

        // Student count
        // Fetch all classes first
        const { data: classes } = await supabaseClient.from('bot_classes').select('id').eq('user_id', currentUserId);
        let studentCount = 0;
        if (classes && classes.length > 0) {
            const classIds = classes.map(c => c.id);
            const { count: sCount } = await supabaseClient.from('bot_students').select('*', { count: 'exact', head: true }).in('class_id', classIds);
            studentCount = sCount || 0;
        }
        document.getElementById('dash-student-count').innerText = studentCount;

    } catch (err) {
        console.error("Dashboard yuklashda xato:", err);
    }
}

async function loadDictionaries() {
    const listEl = document.getElementById('dicts-list');
    if (!listEl) return;
    listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Lug\'atlar yuklanmoqda...</p>';

    try {
        const { data, error } = await supabase
            .from('bot_dictionaries')
            .select('*')
            .eq('user_id', currentUserId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Sizda hali lug\'atlar yo\'q.</p>';
            return;
        }

        let html = '<ul class="item-list">';
        data.forEach(dict => {
            html += `<li>
                          <span>📕 ${dict.name}</span>
                          <div>
                              <button class="btn-sm" style="background:#f3f4f6; color:#374151" onclick="openDictDetailView(${dict.id}, '${dict.name}')"><i class="fa-solid fa-gear"></i></button>
                              <button class="btn-sm" style="background:var(--button-color); color:white" onclick="openActionModal(${dict.id}, 'dict')"><i class="fa-solid fa-play"></i></button>
                          </div>
                     </li>`;
        });
        html += '</ul>';
        listEl.innerHTML = html;

    } catch (err) {
        console.error("Lug'atlarni yuklashda xato:", err);
        listEl.innerHTML = `<p style="color:red; font-size: 13px; text-align:center;">Xatolik: ${err.message || 'Noma\'lum xato'}</p>`;
    }
}

async function loadTests() {
    const listEl = document.getElementById('tests-list');
    if (!listEl) return;
    listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Testlar yuklanmoqda...</p>';

    try {
        const { data, error } = await supabase
            .from('bot_tests')
            .select('*')
            .eq('user_id', currentUserId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Sizda hali testlar yo\'q.</p>';
            return;
        }

        let html = '<ul class="item-list">';
        data.forEach(test => {
            html += `<li>
                                            <span>📄 ${test.title}</span>
                                            <div>
                                                <button class="btn-sm" style="background:#f3f4f6; color:#374151" onclick="openTestDetailView(${test.id}, '${test.title.replace(/'/g, "\\'")}')"><i class="fa-solid fa-gear"></i></button>
                                                <button class="btn-sm" style="background:var(--button-color); color:white" onclick="openActionModal(${test.id}, 'test')"><i class="fa-solid fa-play"></i></button>
                                            </div>
                                       </li>`;
        });
        html += '</ul>';
        listEl.innerHTML = html;

    } catch (err) {
        console.error("Testlarni yuklashda xato:", err);
        listEl.innerHTML = `<p style="color:red; font-size: 13px; text-align:center;">Xatolik: ${err.message || 'Noma\'lum xato'}</p>`;
    }
}

async function loadClasses() {
    const listEl = document.getElementById('classes-list');
    listEl.innerHTML = '<p style="color:var(--hint-color); font-size: 13px; text-align: center;">Sinflar yuklanmoqda...</p>';

    try {
        const { data, error } = await supabase
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

    } catch (err) {
        console.error("Sinflarni yuklashda xato:", err);
        listEl.innerHTML = `<p style="color:red; font-size: 13px; text-align:center;">Xatolik yuz berdi. Pultni sozlaganmisiz?</p>`;
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
        const { data, error } = await supabase
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

            html += `<li>
                        <div style="display:flex; flex-direction:column; gap:4px;">
                            <span><b>${student.student_id_in_class}.</b> ${student.full_name}</span>
                            ${remoteText}
                        </div>
                        <button class="btn-sm" style="background-color: var(--button-color); color: white; border-radius:8px;" onclick="openAssignRemoteModal(${student.id}, '${student.full_name}')">
                            <i class="fa-solid fa-link"></i> Ulash
                        </button>
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
            const { error } = await supabase
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
// TEST / DICTIONARY CREATE MODAL
// ==========================================

function openCreateModal(type) {
    document.getElementById('create-type').value = type;
    const modal = document.getElementById('create-modal');
    const titleText = type === 'test' ? 'Yangi Test Qo\'shish' : 'Yangi Lug\'at Qo\'shish';
    document.getElementById('create-modal-title').innerText = titleText;
    document.getElementById('create-title-input').value = '';

    // Animate display in
    modal.style.display = 'flex';
    setTimeout(() => modal.style.opacity = '1', 10);
}

function closeCreateModal() {
    const modal = document.getElementById('create-modal');
    modal.style.opacity = '0';
    setTimeout(() => modal.style.display = 'none', 300);
}

async function submitCreateItem() {
    const type = document.getElementById('create-type').value;
    const title = document.getElementById('create-title-input').value.trim();

    if (!title) {
        Swal.fire('Diqqat', 'Iltimos nomni kiriting', 'warning');
        return;
    }

    try {
        let tableName = type === 'test' ? 'bot_tests' : 'bot_dictionaries';
        let insertData = { user_id: currentUserId };

        if (type === 'test') {
            insertData.title = title;
        } else {
            insertData.name = title;
        }

        const { error } = await supabaseClient.from(tableName).insert([insertData]);

        if (error) throw error;

        Swal.fire({
            title: 'Muvaffaqiyatli!',
            text: 'Muvaffaqiyatli saqlandi',
            icon: 'success',
            timer: 1500,
            showConfirmButton: false
        });

        closeCreateModal();

        // Refresh lists and dashboard based on where we are
        if (type === 'test') loadTests();
        if (type === 'dict') loadDictionaries();
        loadDashboardStats();

    } catch (err) {
        console.error("Yaratishda xato:", err);
        Swal.fire('Xatolik', err.message || 'Saqlash imkonsiz', 'error');
    }
}

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

    // Sends data back to the Telegram Bot via WebApp sendData
    // The Telegram bot will receive a custom string identifying the action, item, and ID
    const payload = `${actionType}_${itemType}_${itemId}`;

    // Check if we are inside telegram
    if (tg.initDataUnsafe && tg.initDataUnsafe.query_id) {
        // We can use sendData if opened via keyboard button (Not inline)
        tg.sendData(payload);
    } else {
        // Fallback for standalone web view testing
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
        const { data: questions, error: qError } = await supabase
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
        const { data: options, error: optError } = await supabase
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
        const { data: qData, error: qErr } = await supabase
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
        const { data, error } = await supabase
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
        const { error } = await supabase
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
