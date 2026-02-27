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
        const { count: testCount } = await supabase.from('bot_tests').select('*', { count: 'exact', head: true }).eq('user_id', currentUserId);
        document.getElementById('dash-test-count').innerText = testCount || 0;

        // Dict count
        const { count: dictCount } = await supabase.from('bot_dictionaries').select('*', { count: 'exact', head: true }).eq('user_id', currentUserId);
        document.getElementById('dash-dict-count').innerText = dictCount || 0;

        // Class count
        const { count: classCount } = await supabase.from('bot_classes').select('*', { count: 'exact', head: true }).eq('user_id', currentUserId);
        document.getElementById('dash-class-count').innerText = classCount || 0;

        // Student count
        // Fetch all classes first
        const { data: classes } = await supabase.from('bot_classes').select('id').eq('user_id', currentUserId);
        let studentCount = 0;
        if (classes && classes.length > 0) {
            const classIds = classes.map(c => c.id);
            const { count: sCount } = await supabase.from('bot_students').select('*', { count: 'exact', head: true }).in('class_id', classIds);
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
                              <button class="btn-sm" style="background:#f3f4f6; color:#374151" onclick="alert('Tez kunda...')"><i class="fa-solid fa-gear"></i></button>
                              <button class="btn-sm" style="background:var(--button-color); color:white" onclick="openActionModal(${dict.id}, 'dict')"><i class="fa-solid fa-play"></i></button>
                          </div>
                     </li>`;
        });
        html += '</ul>';
        listEl.innerHTML = html;

    } catch (err) {
        console.error("Lug'atlarni yuklashda xato:", err);
        listEl.innerHTML = `<p style="color:red; font-size: 13px; text-align:center;">Lug'atlarni yuklashda xatolik yuz berdi.</p>`;
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
                                                <button class="btn-sm" style="background:#f3f4f6; color:#374151" onclick="alert('Tez kunda...')"><i class="fa-solid fa-gear"></i></button>
                                                <button class="btn-sm" style="background:var(--button-color); color:white" onclick="openActionModal(${test.id}, 'test')"><i class="fa-solid fa-play"></i></button>
                                            </div>
                                       </li>`;
        });
        html += '</ul>';
        listEl.innerHTML = html;

    } catch (err) {
        console.error("Testlarni yuklashda xato:", err);
        listEl.innerHTML = `<p style="color:red; font-size: 13px; text-align:center;">Testlarni yuklashda xatolik yuz berdi.</p>`;
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

        const { error } = await supabase.from(tableName).insert([insertData]);

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
        Swal.fire('Xatolik', 'Saqlash imkonsiz', 'error');
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
