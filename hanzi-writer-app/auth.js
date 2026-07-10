// auth.js - Authentication, Admin, and Learning History Module (Railway/PostgreSQL)
(function() {
    'use strict';

    var API_BASE = '/api';
    var currentUser = null;
    var authToken = null;
    var adminToken = null;
    var isAdmin = false;
    var googleClientId = null;
    // ===== INIT =====
    function initAuth() {
        var saved = localStorage.getItem('auth_token');
        var savedUser = localStorage.getItem('auth_user');
        if (saved && savedUser) {
            authToken = saved;
            try { currentUser = JSON.parse(savedUser); } catch(e) { currentUser = null; }
        }

        fetch(API_BASE + '/config').then(function(r) { return r.json(); }).then(function(cfg) {
            if (cfg.googleClientId) {
                googleClientId = cfg.googleClientId;
                loadGoogleSignIn();
            }
        }).catch(function() {});

        updateAuthUI();
        loadMyStats();
        checkApprovalStatus();
    }

    function loadGoogleSignIn() {
        if (document.getElementById('gsi-script')) return;
        var script = document.createElement('script');
        script.id = 'gsi-script';
        script.src = 'https://accounts.google.com/gsi/client';
        script.onload = function() {
            google.accounts.id.initialize({
                client_id: googleClientId,
                callback: handleGoogleCredential
            });
            // Render official Google Sign-In button inside login modal
            var btnContainer = document.getElementById('googleBtnContainer');
            if (btnContainer) {
                google.accounts.id.renderButton(btnContainer, {
                    type: 'standard',
                    theme: 'filled_blue',
                    size: 'large',
                    text: 'signin_with',
                    width: 300
                });
            }
        };
        document.head.appendChild(script);
    }

    function handleGoogleCredential(response) {
        fetch(API_BASE + '/auth/google', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credential: response.credential })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            if (data.token && data.user) {
                setAuth(data.token, data.user);
                closeLoginModal();
                if (typeof showToast === 'function') showToast('로그인 성공');
            } else {
                console.error('Google login failed:', data);
                if (typeof showToast === 'function') showToast('로그인 실패: ' + (data.detail || data.error || ''));
            }
        })
        .catch(function(e) {
            console.error('Google login error:', e);
            if (typeof showToast === 'function') showToast('로그인 실패: ' + e.message);
        });
    }

    function setAuth(token, user) {
        authToken = token;
        currentUser = user;
        localStorage.setItem('auth_token', authToken);
        localStorage.setItem('auth_user', JSON.stringify(currentUser));
        updateAuthUI();
        loadMyStats();
        checkApprovalStatus();
    }

    function checkApprovalStatus() {
        if (!authToken || !currentUser) return;
        fetch(API_BASE + '/auth/status', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            currentUser.approved = !!data.approved;
            localStorage.setItem('auth_user', JSON.stringify(currentUser));
        })
        .catch(function() {});
    }

    // ===== LOGIN MODAL =====
    window.showLoginModal = function() {
        document.getElementById('loginModal').style.display = 'flex';
        // Re-render Google button (may fail if modal was hidden during initial render)
        var btnContainer = document.getElementById('googleBtnContainer');
        if (btnContainer && typeof google !== 'undefined' && google.accounts && googleClientId) {
            btnContainer.innerHTML = '';
            google.accounts.id.renderButton(btnContainer, {
                type: 'standard',
                theme: 'filled_blue',
                size: 'large',
                text: 'signin_with',
                width: 300
            });
        }
    };

    window.closeLoginModal = function() {
        document.getElementById('loginModal').style.display = 'none';
    };

    // ===== GOOGLE AUTH =====
    window.googleLogin = function() {
        if (!googleClientId) {
            if (typeof showToast === 'function') showToast('Google OAuth 미설정');
            return;
        }
        // Try One Tap prompt; if skipped, guide user to rendered button
        google.accounts.id.prompt(function(notification) {
            if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
                if (typeof showToast === 'function') showToast('위의 Google 버튼을 클릭하세요');
            }
        });
    };

    window.doLogout = function() {
        currentUser = null;
        authToken = null;
        localStorage.removeItem('auth_token');
        localStorage.removeItem('auth_user');
        document.getElementById('myStatsSection').style.display = 'none';
        updateAuthUI();
    };

    // ===== PRACTICE RECORD =====
    window.savePracticeRecord = function(char, correct, mistakes) {
        var record = {
            char: char,
            correct: correct || 0,
            mistakes: mistakes || 0,
            timestamp: new Date().toISOString()
        };

        var records = JSON.parse(localStorage.getItem('practice_records') || '[]');
        records.push(record);
        if (records.length > 2000) records = records.slice(-2000);
        localStorage.setItem('practice_records', JSON.stringify(records));

        if (authToken && currentUser) {
            fetch(API_BASE + '/practices', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + authToken
                },
                body: JSON.stringify(record)
            }).catch(function() {});
        }

        loadMyStats();
    };

    // ===== MY STATS =====
    function loadMyStats() {
        var section = document.getElementById('myStatsSection');
        if (!section) return;

        var records = JSON.parse(localStorage.getItem('practice_records') || '[]');
        if (records.length === 0) { section.style.display = 'none'; return; }

        section.style.display = 'block';
        var charSet = new Set();
        var totalCorrect = 0, totalMistakes = 0, totalSessions = records.length;

        records.forEach(function(r) {
            charSet.add(r.char);
            totalCorrect += r.correct || 0;
            totalMistakes += r.mistakes || 0;
        });

        var accuracy = totalCorrect + totalMistakes > 0
            ? Math.round(totalCorrect / (totalCorrect + totalMistakes) * 100) : 0;

        document.getElementById('myStatChars').textContent = charSet.size;
        document.getElementById('myStatSessions').textContent = totalSessions;
        document.getElementById('myStatAccuracy').textContent = accuracy + '%';

        var recent = records.slice(-10).reverse();
        var html = '';
        recent.forEach(function(r) {
            var d = new Date(r.timestamp);
            var timeStr = d.toLocaleDateString('ko-KR') + ' ' + d.toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'});
            html += '<div class="my-history-item">'
                + '<span class="my-h-char">' + r.char + '</span>'
                + '<span class="my-h-result">정답 ' + (r.correct||0) + ' / 오답 ' + (r.mistakes||0) + '</span>'
                + '<span class="my-h-time">' + timeStr + '</span>'
                + '</div>';
        });
        document.getElementById('myHistoryList').innerHTML = html || '<div style="color:var(--text-dim);padding:10px;">기록 없음</div>';

        // Dashboard charts
        if (typeof initDashboard === 'function') initDashboard();
    }

    window.clearMyRecords = function() {
        if (confirm('학습 기록을 초기화하시겠습니까?')) {
            localStorage.removeItem('practice_records');
            loadMyStats();
            if (typeof showToast === 'function') showToast('학습 기록이 초기화되었습니다');
        }
    };

    // ===== ADMIN =====
    window.showAdminLogin = function() {
        document.getElementById('adminModal').style.display = 'flex';
        setTimeout(function() { document.getElementById('adminPw').focus(); }, 100);
    };

    window.closeAdminModal = function() {
        document.getElementById('adminModal').style.display = 'none';
        document.getElementById('adminPw').value = '';
    };

    window.tryAdminLogin = function() {
        var pw = document.getElementById('adminPw').value;
        fetch(API_BASE + '/auth/admin', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
        })
        .then(function(r) { return r.json().then(function(d) { return { ok: r.ok, data: d }; }); })
        .then(function(result) {
            if (result.ok && result.data.token) {
                isAdmin = true;
                adminToken = result.data.token;
                closeAdminModal();
                showAdminPanel();
            } else {
                if (typeof showToast === 'function') showToast('비밀번호가 틀립니다');
            }
        })
        .catch(function() {
            if (typeof showToast === 'function') showToast('서버 연결 실패');
        });
    };

    window.exitAdmin = function() {
        isAdmin = false;
        adminToken = null;
        document.getElementById('adminPanel').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        updateAuthUI();
    };

    function showAdminPanel() {
        document.getElementById('adminPanel').style.display = 'block';
        document.getElementById('mainContent').style.display = 'none';
        updateAuthUI();
        loadAllLearners();
    }

    function getAdminHeaders() {
        var token = adminToken || authToken;
        return {
            'Content-Type': 'application/json',
            'Authorization': token ? 'Bearer ' + token : ''
        };
    }

    var _adminLearners = [];
    var _adminSortKey = 'last_active';
    var _adminSortAsc = false;

    function loadAllLearners() {
        var listEl = document.getElementById('learnerTableBody');
        var noticeEl = document.getElementById('adminNotice');
        var summaryEl = document.getElementById('adminSummary');

        listEl.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-dim);">로딩 중...</td></tr>';

        fetch(API_BASE + '/admin/learners', { headers: getAdminHeaders() })
        .then(function(r) {
            if (!r.ok) throw new Error('서버 응답 오류');
            return r.json();
        })
        .then(function(learners) {
            noticeEl.style.display = 'none';
            _adminLearners = learners;

            if (learners.length === 0) {
                listEl.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-dim);">등록된 학습자가 없습니다</td></tr>';
                summaryEl.innerHTML = '총 학습자: 0명';
                return;
            }

            var approved = learners.filter(function(d) { return d.approved; }).length;
            summaryEl.innerHTML = '총 학습자: <strong>' + learners.length + '</strong>명 · 승인: <strong style="color:#34d399;">' + approved + '</strong>명 · 미승인: <strong style="color:#f87171;">' + (learners.length - approved) + '</strong>명';

            renderLearnerTable();
            loadAdminCharts();
        })
        .catch(function(e) {
            noticeEl.style.display = 'block';
            noticeEl.innerHTML = '<span style="color:var(--warning);">DB 연결 실패</span> — 서버가 실행 중인지 확인하세요.'
                + '<br><br>현재 이 브라우저의 로컬 데이터만 표시됩니다.';
            showLocalAdminData(listEl, summaryEl);
        });
    }

    function renderLearnerTable() {
        var listEl = document.getElementById('learnerTableBody');
        var sorted = _adminLearners.slice().sort(function(a, b) {
            var va = a[_adminSortKey], vb = b[_adminSortKey];
            if (_adminSortKey === 'approved') { va = va ? 1 : 0; vb = vb ? 1 : 0; }
            if (_adminSortKey === 'name') { va = (va || '').toLowerCase(); vb = (vb || '').toLowerCase(); }
            if (va == null) va = '';
            if (vb == null) vb = '';
            if (va < vb) return _adminSortAsc ? -1 : 1;
            if (va > vb) return _adminSortAsc ? 1 : -1;
            return 0;
        });

        // Update sort indicators
        document.querySelectorAll('.admin-table th.sortable').forEach(function(th) {
            th.classList.remove('sort-asc', 'sort-desc');
            if (th.dataset.sort === _adminSortKey) {
                th.classList.add(_adminSortAsc ? 'sort-asc' : 'sort-desc');
            }
        });

        var html = '';
        sorted.forEach(function(d) {
            var lastActive = d.last_active ? new Date(d.last_active).toLocaleDateString('ko-KR') : '-';
            var createdAt = d.created_at ? new Date(d.created_at).toLocaleDateString('ko-KR') : '-';
            var avatar = d.photo_url
                ? '<img class="admin-avatar" src="' + d.photo_url + '" onerror="this.style.display=\'none\'">'
                : '<div class="admin-avatar-placeholder">?</div>';
            var checkboxHtml = '<input type="checkbox" class="approve-check" '
                + (d.approved ? 'checked' : '')
                + ' onchange="toggleApproval(' + d.id + ', this.checked)" title="승인 체크">';
            html += '<tr>'
                + '<td data-label="프로필">' + avatar + '</td>'
                + '<td data-label="이름">' + (d.name || '-') + '</td>'
                + '<td data-label="이메일">' + (d.email || '-') + '</td>'
                + '<td data-label="승인" style="text-align:center;">' + checkboxHtml + '</td>'
                + '<td data-label="가입일">' + createdAt + '</td>'
                + '<td data-label="최근활동">' + lastActive + '</td>'
                + '<td data-label="" style="white-space:nowrap;">'
                + '<button class="btn btn-sm btn-outline" onclick="viewLearnerDetail(' + d.id + ', this)">상세보기</button> '
                + '<button class="btn btn-sm btn-outline" style="color:var(--accent);" onclick="editLearner(' + d.id + ',\'' + (d.name||'').replace(/'/g,"\\'") + '\',\'' + (d.email||'').replace(/'/g,"\\'") + '\')">수정</button> '
                + '<button class="btn btn-sm btn-outline" style="color:var(--danger);" onclick="deleteLearner(' + d.id + ',\'' + (d.name||'').replace(/'/g,"\\'") + '\')">삭제</button>'
                + '</td>'
                + '</tr>';
        });
        listEl.innerHTML = html;
    }

    window.sortAdminTable = function(key) {
        if (_adminSortKey === key) {
            _adminSortAsc = !_adminSortAsc;
        } else {
            _adminSortKey = key;
            _adminSortAsc = true;
        }
        renderLearnerTable();
    };

    var adminChartInstances = [];

    function loadAdminCharts() {
        if (typeof Chart === 'undefined') return;
        var chartsEl = document.getElementById('adminCharts');
        if (!chartsEl) return;

        fetch(API_BASE + '/admin/stats', { headers: getAdminHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            chartsEl.style.display = 'block';
            adminChartInstances.forEach(function(c) { c.destroy(); });
            adminChartInstances = [];

            var chartColors = {
                accent: 'rgba(94,234,212,0.8)',
                accentBg: 'rgba(94,234,212,0.15)',
                purple: 'rgba(124,106,255,0.8)',
                purpleBg: 'rgba(124,106,255,0.15)',
                success: 'rgba(52,211,153,0.8)',
                warning: 'rgba(251,191,36,0.8)',
                danger: 'rgba(248,113,113,0.8)',
                text: 'rgba(234,234,244,0.7)',
                grid: 'rgba(255,255,255,0.06)'
            };

            var defaults = Chart.defaults;
            defaults.color = chartColors.text;
            defaults.borderColor = chartColors.grid;

            // Daily chart
            var daily = data.daily || [];
            var labels = daily.map(function(d) {
                var dt = new Date(d.day);
                return (dt.getMonth()+1) + '/' + dt.getDate();
            });
            adminChartInstances.push(new Chart(document.getElementById('dailyChart'), {
                type: 'bar',
                data: {
                    labels: labels,
                    datasets: [
                        { label: '정답', data: daily.map(function(d){return d.correct;}), backgroundColor: chartColors.accent, borderRadius: 4 },
                        { label: '오답', data: daily.map(function(d){return d.mistakes;}), backgroundColor: chartColors.danger, borderRadius: 4 }
                    ]
                },
                options: { responsive: true, plugins: { legend: { position: 'top' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
            }));

            // Learner practice count chart
            var learners = data.learners || [];
            var lNames = learners.map(function(l){return l.name || '?';});
            adminChartInstances.push(new Chart(document.getElementById('learnerChart'), {
                type: 'bar',
                data: {
                    labels: lNames,
                    datasets: [{ label: '연습 횟수', data: learners.map(function(l){return l.cnt;}), backgroundColor: chartColors.purple, borderRadius: 4 }]
                },
                options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
            }));

            // Accuracy chart
            var accData = learners.map(function(l) {
                var total = l.correct + l.mistakes;
                return total > 0 ? Math.round(l.correct / total * 100) : 0;
            });
            adminChartInstances.push(new Chart(document.getElementById('accuracyChart'), {
                type: 'bar',
                data: {
                    labels: lNames,
                    datasets: [{ label: '정답률 %', data: accData, backgroundColor: accData.map(function(v){return v >= 70 ? chartColors.success : v >= 40 ? chartColors.warning : chartColors.danger;}), borderRadius: 4 }]
                },
                options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, max: 100 } } }
            }));

            // Chars learned chart
            adminChartInstances.push(new Chart(document.getElementById('charsChart'), {
                type: 'bar',
                data: {
                    labels: lNames,
                    datasets: [{ label: '학습 한자', data: learners.map(function(l){return l.chars;}), backgroundColor: chartColors.accent, borderRadius: 4 }]
                },
                options: { indexAxis: 'y', responsive: true, plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true } } }
            }));
        })
        .catch(function() {
            chartsEl.style.display = 'none';
        });
    }

    function showLocalAdminData(listEl, summaryEl) {
        var records = JSON.parse(localStorage.getItem('practice_records') || '[]');
        if (records.length === 0) {
            summaryEl.innerHTML = '로컬 학습 기록: 0건';
            listEl.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:30px;color:var(--text-dim);">학습 기록이 없습니다</td></tr>';
            return;
        }

        var charSet = new Set();
        var totalCorrect = 0, totalMistakes = 0;
        records.forEach(function(r) {
            charSet.add(r.char);
            totalCorrect += r.correct || 0;
            totalMistakes += r.mistakes || 0;
        });

        summaryEl.innerHTML = '로컬 학습 기록: <strong>' + records.length + '</strong>건 | 학습 한자: <strong>' + charSet.size + '</strong>자';

        var recent = records.slice(-20).reverse();
        var html = '';
        recent.forEach(function(r) {
            var d = new Date(r.timestamp);
            var timeStr = d.toLocaleDateString('ko-KR') + ' ' + d.toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit'});
            html += '<tr>'
                + '<td data-label="한자" style="font-size:28px;font-family:\'Noto Serif KR\',serif;">' + r.char + '</td>'
                + '<td data-label="이름">-</td>'
                + '<td data-label="성적">정답 ' + (r.correct||0) + ' / 오답 ' + (r.mistakes||0) + '</td>'
                + '<td data-label="시간">' + timeStr + '</td>'
                + '<td data-label="">-</td>'
                + '</tr>';
        });
        listEl.innerHTML = html;
    }

    window.viewLearnerDetail = function(uid, btn) {
        // Remove any existing inline detail row
        var old = document.getElementById('learnerDetailRow');
        if (old) old.remove();

        // Find clicked row and insert detail row after it
        var clickedRow = btn ? btn.closest('tr') : null;
        var detailRow = document.createElement('tr');
        detailRow.id = 'learnerDetailRow';
        var detailCell = document.createElement('td');
        detailCell.colSpan = 7;
        detailCell.style.cssText = 'padding:0;border:none;';
        detailCell.innerHTML = '<div class="learner-detail-panel" style="display:block;"><div style="text-align:center;padding:40px;color:var(--text-dim);">로딩 중...</div></div>';
        detailRow.appendChild(detailCell);

        if (clickedRow && clickedRow.nextSibling) {
            clickedRow.parentNode.insertBefore(detailRow, clickedRow.nextSibling);
        } else if (clickedRow) {
            clickedRow.parentNode.appendChild(detailRow);
        } else {
            document.getElementById('learnerTableBody').appendChild(detailRow);
        }

        var panel = detailCell.querySelector('.learner-detail-panel');

        fetch(API_BASE + '/admin/learners/' + uid, { headers: getAdminHeaders() })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            var ud = data.user;
            var practiceList = data.practices || [];

            var totalCorrect = 0, totalMistakes = 0, charSet = new Set();
            practiceList.forEach(function(p) {
                totalCorrect += p.correct || 0;
                totalMistakes += p.mistakes || 0;
                charSet.add(p.char);
            });

            var accuracy = totalCorrect + totalMistakes > 0
                ? Math.round(totalCorrect / (totalCorrect + totalMistakes) * 100) : 0;

            var html = '<div class="detail-header">'
                + '<div class="detail-profile">'
                + (ud.photo_url ? '<img class="detail-avatar" src="' + ud.photo_url + '">' : '')
                + '<div>'
                + '<h3 style="font-size:18px;font-weight:700;">' + (ud.name || '이름 없음') + '</h3>'
                + '<p style="color:var(--text-dim);font-size:13px;">' + (ud.email || '') + '</p>'
                + '</div>'
                + '</div>'
                + '<button class="btn btn-sm btn-outline" onclick="var r=document.getElementById(\'learnerDetailRow\');if(r)r.remove();">닫기</button>'
                + '</div>';

            var lastDate = '-';
            if (practiceList.length > 0 && practiceList[0].created_at) {
                lastDate = new Date(practiceList[0].created_at).toLocaleDateString('ko-KR', {year:'numeric',month:'long',day:'numeric'});
            }

            html += '<div class="detail-stats">'
                + '<div class="detail-stat"><div class="detail-stat-val accent">' + charSet.size + '</div><div class="detail-stat-lbl">학습 한자</div></div>'
                + '<div class="detail-stat"><div class="detail-stat-val success">' + practiceList.length + '</div><div class="detail-stat-lbl">연습 횟수</div></div>'
                + '<div class="detail-stat"><div class="detail-stat-val warning">' + accuracy + '%</div><div class="detail-stat-lbl">정답률</div></div>'
                + '<div class="detail-stat"><div class="detail-stat-val danger">' + totalMistakes + '</div><div class="detail-stat-lbl">총 오답</div></div>'
                + '<div class="detail-stat"><div class="detail-stat-val" style="color:var(--text);font-size:16px;">' + lastDate + '</div><div class="detail-stat-lbl">최근 학습</div></div>'
                + '</div>';
            panel.innerHTML = html;
            setTimeout(function() { detailRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 100);
        })
        .catch(function(e) {
            panel.innerHTML = '<div style="color:var(--danger);padding:20px;">로딩 실패: ' + e.message
                + '<br><button class="btn btn-sm btn-outline" style="margin-top:10px;" onclick="var r=document.getElementById(\'learnerDetailRow\');if(r)r.remove();">닫기</button></div>';
        });
    };

    // ===== EDIT / DELETE LEARNER =====
    window.editLearner = function(uid, currentName, currentEmail) {
        var overlay = document.createElement('div');
        overlay.id = 'editLearnerOverlay';
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';
        overlay.innerHTML = '<div style="background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:28px;max-width:400px;width:90%;">'
            + '<h3 style="margin-bottom:16px;font-size:18px;font-weight:700;">회원정보 수정</h3>'
            + '<label style="font-size:13px;color:var(--text-dim);display:block;margin-bottom:4px;">이름</label>'
            + '<input id="editName" type="text" value="' + currentName.replace(/"/g,'&quot;') + '" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:14px;margin-bottom:12px;box-sizing:border-box;">'
            + '<label style="font-size:13px;color:var(--text-dim);display:block;margin-bottom:4px;">이메일</label>'
            + '<input id="editEmail" type="email" value="' + currentEmail.replace(/"/g,'&quot;') + '" style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface2);color:var(--text);font-size:14px;margin-bottom:20px;box-sizing:border-box;">'
            + '<div style="display:flex;gap:8px;justify-content:flex-end;">'
            + '<button class="btn btn-sm btn-outline" onclick="document.getElementById(\'editLearnerOverlay\').remove()">취소</button>'
            + '<button class="btn btn-sm btn-primary" onclick="submitEditLearner(' + uid + ')">저장</button>'
            + '</div></div>';
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        document.getElementById('editName').focus();
    };

    window.submitEditLearner = function(uid) {
        var name = document.getElementById('editName').value.trim();
        var email = document.getElementById('editEmail').value.trim();
        if (!name) { alert('이름을 입력하세요'); return; }

        fetch(API_BASE + '/admin/learners/' + uid, {
            method: 'PUT',
            headers: Object.assign({'Content-Type':'application/json'}, getAdminHeaders()),
            body: JSON.stringify({ name: name, email: email })
        })
        .then(function(r) {
            if (!r.ok) throw new Error('수정 실패');
            return r.json();
        })
        .then(function() {
            document.getElementById('editLearnerOverlay').remove();
            showToast('회원정보가 수정되었습니다');
            loadAllLearners();
        })
        .catch(function(e) { alert(e.message); });
    };

    window.toggleApproval = function(uid, approve) {
        fetch(API_BASE + '/admin/learners/' + uid + '/approve', {
            method: 'PATCH',
            headers: getAdminHeaders(),
            body: JSON.stringify({ approved: approve })
        })
        .then(function(r) {
            if (!r.ok) throw new Error('승인 변경 실패');
            return r.json();
        })
        .then(function(data) {
            showToast(data.name + ' 회원이 ' + (data.approved ? '승인' : '승인취소') + '되었습니다');
            loadAllLearners();
        })
        .catch(function(e) { alert(e.message); });
    };

    window.deleteLearner = function(uid, name) {
        if (!confirm('"' + name + '" 회원을 삭제하시겠습니까?\n\n학습 기록도 모두 삭제됩니다. 이 작업은 되돌릴 수 없습니다.')) return;

        fetch(API_BASE + '/admin/learners/' + uid, {
            method: 'DELETE',
            headers: getAdminHeaders()
        })
        .then(function(r) {
            if (!r.ok) throw new Error('삭제 실패');
            return r.json();
        })
        .then(function() {
            var detailRow = document.getElementById('learnerDetailRow');
            if (detailRow) detailRow.remove();
            showToast('"' + name + '" 회원이 삭제되었습니다');
            loadAllLearners();
        })
        .catch(function(e) { alert(e.message); });
    };

    // ===== UI UPDATE =====
    function updateAuthUI() {
        var loginBtn = document.getElementById('loginBtn');
        var userInfo = document.getElementById('navUserInfo');
        var adminBadge = document.getElementById('adminBadge');

        if (!loginBtn || !userInfo) return;

        if (currentUser) {
            loginBtn.style.display = 'none';
            userInfo.style.display = 'flex';
            var avatar = document.getElementById('navUserAvatar');
            var name = document.getElementById('navUserName');
            if (avatar) {
                if (currentUser.photoURL) { avatar.src = currentUser.photoURL; avatar.style.display = ''; }
                else { avatar.style.display = 'none'; }
            }
            if (name) name.textContent = currentUser.name || currentUser.email || '';
        } else {
            loginBtn.style.display = 'inline-flex';
            userInfo.style.display = 'none';
        }

        if (adminBadge) {
            adminBadge.style.display = isAdmin ? 'inline-flex' : 'none';
        }
    }

    window.isUserLoggedIn = function() { return !!currentUser; };
    window.getCurrentUser = function() { return currentUser; };
    window.isUserApproved = function() {
        if (!currentUser) return false;
        return currentUser.approved !== false;
    };
    window.recheckApproval = function(cb) {
        if (!authToken || !currentUser) return cb(false);
        fetch(API_BASE + '/auth/status', {
            headers: { 'Authorization': 'Bearer ' + authToken }
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
            currentUser.approved = !!data.approved;
            localStorage.setItem('auth_user', JSON.stringify(currentUser));
            cb(!!data.approved);
        })
        .catch(function() { cb(false); });
    };

    // ===== INIT ON LOAD =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(initAuth, 100); });
    } else {
        setTimeout(initAuth, 100);
    }
})();
