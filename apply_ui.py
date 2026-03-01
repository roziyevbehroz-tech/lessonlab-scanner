import re

with open(r'e:\\LLabbot\\scanner\\display.html', 'r', encoding='utf-8') as f:
    html = f.read()

# 1. Add CSS for new elements
css_additions = """
        /* --- SIDEBAR --- */
        #responses-sidebar {
            position: fixed;
            top: 0;
            right: 0;
            width: 350px;
            height: 100vh;
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(15px);
            border-left: 2px solid rgba(255, 255, 255, 0.1);
            z-index: 1000;
            transform: translateX(100%);
            transition: transform 0.4s cubic-bezier(0.4, 0, 0.2, 1);
            display: flex;
            flex-direction: column;
            box-shadow: -10px 0 30px rgba(0,0,0,0.5);
        }
        #responses-sidebar.open {
            transform: translateX(0);
        }
        .sidebar-header {
            padding: 2rem;
            border-bottom: 2px solid rgba(255,255,255,0.05);
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 1.8rem;
            font-weight: 800;
            color: #fff;
        }
        .sidebar-list {
            flex: 1;
            overflow-y: auto;
            padding: 2rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
        }
        .sidebar-list::-webkit-scrollbar { width: 5px; }
        .sidebar-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.2); border-radius: 5px; }
        
        .sidebar-item {
            background: rgba(255, 255, 255, 0.05);
            padding: 1.5rem;
            border-radius: 1rem;
            font-size: 1.5rem;
            font-weight: 600;
            color: var(--text-muted);
            display: flex;
            justify-content: center;
            transition: 0.3s;
        }
        .sidebar-item.answered {
            background: rgba(16, 185, 129, 0.15);
            color: #fff;
            border: 1px solid var(--success);
            box-shadow: 0 0 15px rgba(16,185,129,0.3);
        }

        /* --- TOGGLE SWITCH --- */
        .switch {
            position: relative;
            display: inline-block;
            width: 50px;
            height: 28px;
            margin-left: 15px;
        }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider {
            position: absolute;
            cursor: pointer;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: #334155;
            transition: .4s;
            border-radius: 34px;
        }
        .slider:before {
            position: absolute;
            content: "";
            height: 20px; width: 20px;
            left: 4px; bottom: 4px;
            background-color: white;
            transition: .4s;
            border-radius: 50%;
        }
        input:checked + .slider { background-color: var(--success); }
        input:checked + .slider:before { transform: translateX(22px); }

        /* --- POST-QUESTION RESULTS SCREEN --- */
        #screen-question-results {
            flex-direction: column;
            justify-content: flex-start;
            padding: 4rem;
            width: 100%;
            max-width: 1700px;
            margin: 0 auto;
        }
        .accuracy-bar-container {
            width: 100%;
            background: var(--danger);
            height: 40px;
            border-radius: 20px;
            margin-bottom: 4rem;
            position: relative;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            display: flex;
            align-items: center;
        }
        .accuracy-fill {
            height: 100%;
            background: var(--success);
            border-radius: 20px 0 0 20px;
            transition: width 1s cubic-bezier(0.4, 0, 0.2, 1);
            width: 0%;
        }
        .accuracy-badge {
            position: absolute;
            left: 50%;
            top: 50%;
            transform: translate(-50%, -50%);
            background: #fff;
            color: #000;
            font-size: 2rem;
            font-weight: 900;
            padding: 1rem 2rem;
            border-radius: 30px;
            box-shadow: 0 0 20px rgba(255,255,255,0.5);
            z-index: 2;
        }
        .accuracy-labels {
            position: absolute;
            width: 100%;
            display: flex;
            justify-content: space-between;
            padding: 0 2rem;
            font-size: 1.8rem;
            font-weight: 800;
            color: #fff;
            pointer-events: none;
        }
        
        .results-main-layout {
            display: flex;
            width: 100%;
            gap: 4rem;
        }
        .results-left {
            flex: 2;
            background: var(--bg-card);
            border-radius: 2rem;
            padding: 3rem;
            box-shadow: 0 10px 40px rgba(0,0,0,0.5);
        }
        .results-question-text {
            font-size: 2.5rem;
            font-weight: 800;
            margin-bottom: 3rem;
            border-bottom: 2px solid rgba(255,255,255,0.1);
            padding-bottom: 2rem;
        }
        .results-option-row {
            display: flex;
            align-items: center;
            margin-bottom: 2rem;
            gap: 2rem;
        }
        .results-badge {
            width: 50px; height: 50px;
            border-radius: 50%;
            display: flex; align-items: center; justify-content: center;
            font-size: 2rem; font-weight: 800;
            background: #334155; color: #fff;
        }
        .results-bar-wrap {
            flex: 1;
            height: 30px;
            background: rgba(0,0,0,0.3);
            border-radius: 15px;
            position: relative;
        }
        .results-bar-fill {
            height: 100%;
            background: var(--danger);
            border-radius: 15px;
            transition: width 1s ease-out;
            width: 0%;
        }
        .results-bar-fill.correct {
            background: var(--success);
        }
        .results-count {
            font-size: 2rem;
            font-weight: 900;
            width: 40px;
            text-align: right;
        }

        .results-right {
            flex: 1;
            background: rgba(0,0,0,0.4);
            border-radius: 2rem;
            padding: 2rem;
            display: flex;
            flex-direction: column;
        }
        .mini-leaderboard-title {
            font-size: 2rem;
            font-weight: 800;
            margin-bottom: 2rem;
            display: flex;
            justify-content: space-between;
            color: var(--text-muted);
            border-bottom: 1px solid rgba(255,255,255,0.1);
            padding-bottom: 1rem;
        }
        .mini-rank-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 1.5rem;
            background: rgba(255,255,255,0.05);
            border-radius: 1rem;
            margin-bottom: 1rem;
            font-size: 1.8rem;
            font-weight: 700;
        }
        .mini-rank-item:nth-child(1) { border-left: 4px solid #fbbf24; }
        .mini-rank-item:nth-child(2) { border-left: 4px solid #94a3b8; }
        .mini-rank-item:nth-child(3) { border-left: 4px solid #b45309; }
"""

html = html.replace('</style>', css_additions + '\n    </style>')

# 2. Update Top Bar HTML
top_bar_new = """    <div class="top-bar">
        <div class="title" style="display:flex; align-items:center; gap:20px;">
            <div id="top-question-badge" style="background:#1e293b; padding:10px 20px; border-radius:15px; font-size:1.8rem; color:#fff; border:1px solid rgba(255,255,255,0.1);">Question -/-</div>
            <div style="font-size: 1.8rem; display:flex; align-items:center; color:#fff; font-weight:700;">
                Show student responses
                <label class="switch">
                    <input type="checkbox" id="toggle-sidebar">
                    <span class="slider"></span>
                </label>
            </div>
        </div>
        <div class="status" id="connection-status"><i class="fa-solid fa-wifi" style="color:var(--warning)"></i> Kutilyapti</div>
    </div>"""

html = re.sub(r'<div class="top-bar">.*?</div>\n    </div>', top_bar_new, html, flags=re.DOTALL)

# 3. Add Sidebar and Results Screen HTML right before LEADBOARD SCREEN
screens_add = """    <!-- SIDEBAR -->
    <div id="responses-sidebar">
        <div class="sidebar-header">
            <span>Responses</span>
            <span id="sidebar-count">0/0</span>
        </div>
        <div class="sidebar-list" id="sidebar-list">
            <!-- Populated dynamically -->
        </div>
    </div>

    <!-- POST-QUESTION RESULTS SCREEN -->
    <div id="screen-question-results" class="screen">
        
        <div style="width:100%; text-align:center; margin-bottom: 2rem;">
            <div style="display:inline-block; background:rgba(255,255,255,0.1); padding:1rem 3rem; border-radius:30px; font-size:2rem; font-weight:800;">
                <i class="fa-solid fa-users"></i> <span id="results-total-responses">0 responses collected</span>
            </div>
        </div>

        <div class="accuracy-bar-container">
            <div class="accuracy-fill" id="res-accuracy-fill"></div>
            <div class="accuracy-badge" id="res-accuracy-badge">0% Accuracy</div>
            <div class="accuracy-labels">
                <span id="res-correct-pts">0 pts</span>
                <span id="res-wrong-pts">0 pts</span>
            </div>
        </div>

        <div class="results-main-layout">
            <div class="results-left">
                <div class="results-question-text" id="res-q-text">Question Text...</div>
                <div id="res-options-container">
                    <!-- Option bars populated here -->
                </div>
            </div>
            <div class="results-right">
                <div class="mini-leaderboard-title">
                    <span>Rank</span>
                    <span>Name</span>
                    <span>Points</span>
                </div>
                <div id="res-mini-leaderboard">
                    <!-- Top 4 ranks populated here -->
                </div>
            </div>
        </div>
    </div>

    <!-- LEADERBOARD SCREEN -->"""

html = html.replace('<!-- LEADERBOARD SCREEN -->', screens_add)

# 4. JavaScript Logic Updates
js_updates = """
        // --- Added Logic for Sidebar and Result Screen ---
        document.getElementById('toggle-sidebar').addEventListener('change', function(e) {
            const sidebar = document.getElementById('responses-sidebar');
            if(e.target.checked) sidebar.classList.add('open');
            else sidebar.classList.remove('open');
        });

        function updateSidebar() {
            const list = document.getElementById('sidebar-list');
            const sortedStudents = Object.values(students).sort((a,b) => a.id - b.id);
            let html = '';
            let answeredCount = 0;
            sortedStudents.forEach(st => {
                const isAns = studentAnswersCurrent[st.id] !== undefined;
                if(isAns) answeredCount++;
                html += `<div class="sidebar-item ${isAns ? 'answered' : ''}">P${st.remote_id || st.id}</div>`;
            });
            list.innerHTML = html;
            document.getElementById('sidebar-count').innerText = `${answeredCount}/${sortedStudents.length}`;
        }

        function showQuestionResults() {
            clearInterval(timerInterval);
            document.getElementById('timer-fill').style.transform = 'scaleX(0)';
            
            showScreen('question-results');
            
            const q = questions[currentQuestionIndex];
            document.getElementById('res-q-text').innerText = `${currentQuestionIndex + 1}. ${q.text}`;
            
            // Calculate votes
            let totalVotes = 0;
            let correctVotes = 0;
            let optionCounts = [0, 0, 0, 0];
            
            Object.values(studentAnswersCurrent).forEach(ansIdx => {
                totalVotes++;
                if(ansIdx >= 0 && ansIdx <= 3) {
                    optionCounts[ansIdx]++;
                    if(ansIdx === q.correct) correctVotes++;
                }
            });
            
            document.getElementById('results-total-responses').innerText = `${totalVotes} responses collected`;
            
            // Accuracy Bar
            const accuracy = totalVotes > 0 ? Math.round((correctVotes / totalVotes) * 100) : 0;
            setTimeout(() => {
                document.getElementById('res-accuracy-fill').style.width = `${accuracy}%`;
            }, 100);
            document.getElementById('res-accuracy-badge').innerText = `${accuracy}% Accuracy`;
            document.getElementById('res-correct-pts').innerText = `${correctVotes} pts`;
            document.getElementById('res-wrong-pts').innerText = `${totalVotes - correctVotes} pts`;
            
            // Option Bars
            let optsHtml = '';
            const labels = ['A', 'B', 'C', 'D'];
            q.options.forEach((opt, idx) => {
                const count = optionCounts[idx];
                const pct = totalVotes > 0 ? (count / totalVotes) * 100 : 0;
                const isCorrect = (idx === q.correct);
                
                optsHtml += `
                    <div class="results-option-row">
                        <div class="results-badge" style="background: ${isCorrect ? 'var(--success)' : 'rgba(255,255,255,0.1)'}">${labels[idx]}</div>
                        <div style="flex:1; display:flex; flex-direction:column; gap:10px;">
                            <div style="font-size:1.6rem; font-weight:600; color: ${isCorrect ? '#fff' : 'var(--text-muted)'}">${opt.text}</div>
                            <div class="results-bar-wrap">
                                <div class="results-bar-fill ${isCorrect ? 'correct' : ''}" style="width: ${pct}%"></div>
                            </div>
                        </div>
                        <div class="results-count">${count}</div>
                    </div>
                `;
            });
            document.getElementById('res-options-container').innerHTML = optsHtml;
            
            // Mini Leaderboard
            const sorted = Object.values(students).sort((a, b) => studentScores[b.id] - studentScores[a.id]);
            let miniHtml = '';
            sorted.slice(0, 4).forEach((st, idx) => {
                miniHtml += `
                    <div class="mini-rank-item">
                        <div style="width:30px; text-align:center;">${idx+1}</div>
                        <div style="flex:1; padding-left:20px;">${st.full_name.split(' ')[0]}</div>
                        <div>${studentScores[st.id]}</div>
                    </div>
                `;
            });
            document.getElementById('res-mini-leaderboard').innerHTML = miniHtml;
        }
"""

html = html.replace("const loadingStr = document.getElementById('loading');", "const loadingStr = document.getElementById('loading');\n" + js_updates)

# Subbing renderQuestion additions
html = html.replace("document.getElementById('question-text').innerText = `${currentQuestionIndex + 1}. ${q.text}`;", 
                    "document.getElementById('question-text').innerText = `${currentQuestionIndex + 1}. ${q.text}`;\n            document.getElementById('top-question-badge').innerText = `Question ${currentQuestionIndex + 1}/${questions.length}`;\n            updateSidebar();")

html = html.replace("screens[name].classList.add('active');", 
                    "if(screens[name]) screens[name].classList.add('active');")


# Replace handleRemoteSignal saving format
html = html.replace("studentAnswersCurrent[studentId] = true;", 
                    "const keyMap = { 'A': 0, 'B': 1, 'C': 2, 'D': 3 };\n                const ansIdx = typeof answer === 'string' ? keyMap[answer.toUpperCase()] : answer;\n                studentAnswersCurrent[studentId] = ansIdx;\n                updateSidebar();")

# Inject showQuestionResults into scan_submit action 
# Need to replace the previously added toggle logic for scan_submit
old_scan = """                } else if (action === 'scan_submit') {
                    // Yangi mantiq: Ustoz tasdiqlaganda to'g'ri javobni doskada ajratib ko'rsatish
                    if (document.getElementById('setting-show-results').checked) {
                        showCorrectAnswer();
                    } else {
                        clearInterval(timerInterval);
                        document.getElementById('timer-fill').style.transform = 'scaleX(0)';
                        document.querySelectorAll('.option-btn').forEach(opt => opt.classList.add('dimmed'));
                    }
                }"""

new_scan = """                } else if (action === 'scan_submit') {
                    if (document.getElementById('setting-show-results').checked) {
                        showQuestionResults();
                    } else {
                        clearInterval(timerInterval);
                        document.getElementById('timer-fill').style.transform = 'scaleX(0)';
                        document.querySelectorAll('.option-btn').forEach(opt => opt.classList.add('dimmed'));
                    }
                }"""

html = html.replace(old_scan, new_scan)

# Add screen reference to screens const
html = html.replace("leaderboard: document.getElementById('screen-leaderboard')", "leaderboard: document.getElementById('screen-leaderboard'),\n            'question-results': document.getElementById('screen-question-results')")


with open(r'e:\\LLabbot\\scanner\\display.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("done")
