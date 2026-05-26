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

    function loadAllLearners() {
        var listEl = document.getElementById('learnerTableBody');
        var noticeEl = document.getElementById('adminNotice');
        var summaryEl = document.getElementById('adminSummary');

        listEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-dim);">로딩 중...</td></tr>';

        fetch(API_BASE + '/admin/learners', { headers: getAdminHeaders() })
        .then(function(r) {
            if (!r.ok) throw new Error('서버 응답 오류');
            return r.json();
        })
        .then(function(learners) {
            noticeEl.style.display = 'none';

            if (learners.length === 0) {
                listEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-dim);">등록된 학습자가 없습니다</td></tr>';
                summaryEl.innerHTML = '총 학습자: 0명';
                return;
            }

            summaryEl.innerHTML = '총 학습자: <strong>' + learners.length + '</strong>명';
            var html = '';
            learners.forEach(function(d) {
                var lastActive = d.last_active ? new Date(d.last_active).toLocaleDateString('ko-KR') : '-';
                var avatar = d.photo_url
                    ? '<img class="admin-avatar" src="' + d.photo_url + '" onerror="this.style.display=\'none\'">'
                    : '<div class="admin-avatar-placeholder">?</div>';
                html += '<tr>'
                    + '<td>' + avatar + '</td>'
                    + '<td>' + (d.name || '-') + '</td>'
                    + '<td>' + (d.email || '-') + '</td>'
                    + '<td>' + lastActive + '</td>'
                    + '<td><button class="btn btn-sm btn-outline" onclick="viewLearnerDetail(' + d.id + ')">상세보기</button></td>'
                    + '</tr>';
            });
            listEl.innerHTML = html;
        })
        .catch(function(e) {
            noticeEl.style.display = 'block';
            noticeEl.innerHTML = '<span style="color:var(--warning);">DB 연결 실패</span> — 서버가 실행 중인지 확인하세요.'
                + '<br><br>현재 이 브라우저의 로컬 데이터만 표시됩니다.';
            showLocalAdminData(listEl, summaryEl);
        });
    }

    function showLocalAdminData(listEl, summaryEl) {
        var records = JSON.parse(localStorage.getItem('practice_records') || '[]');
        if (records.length === 0) {
            summaryEl.innerHTML = '로컬 학습 기록: 0건';
            listEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-dim);">학습 기록이 없습니다</td></tr>';
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
                + '<td style="font-size:28px;font-family:\'Noto Serif KR\',serif;">' + r.char + '</td>'
                + '<td>-</td>'
                + '<td>정답 ' + (r.correct||0) + ' / 오답 ' + (r.mistakes||0) + '</td>'
                + '<td>' + timeStr + '</td>'
                + '<td>-</td>'
                + '</tr>';
        });
        listEl.innerHTML = html;
    }

    window.viewLearnerDetail = function(uid) {
        var panel = document.getElementById('learnerDetail');
        panel.style.display = 'block';
        panel.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim);">로딩 중...</div>';

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
                + '<button class="btn btn-sm btn-outline" onclick="document.getElementById(\'learnerDetail\').style.display=\'none\'">닫기</button>'
                + '</div>';

            html += '<div class="detail-stats">'
                + '<div class="detail-stat"><div class="detail-stat-val accent">' + charSet.size + '</div><div class="detail-stat-lbl">학습 한자</div></div>'
                + '<div class="detail-stat"><div class="detail-stat-val success">' + practiceList.length + '</div><div class="detail-stat-lbl">연습 횟수</div></div>'
                + '<div class="detail-stat"><div class="detail-stat-val warning">' + accuracy + '%</div><div class="detail-stat-lbl">정답률</div></div>'
                + '<div class="detail-stat"><div class="detail-stat-val danger">' + totalMistakes + '</div><div class="detail-stat-lbl">총 오답</div></div>'
                + '</div>';

            html += '<div class="detail-list-header">최근 학습 기록</div>';
            html += '<div class="detail-list">';
            if (practiceList.length === 0) {
                html += '<div style="color:var(--text-dim);padding:20px;text-align:center;">학습 기록이 없습니다</div>';
            } else {
                practiceList.forEach(function(p) {
                    var timeStr = p.created_at ? new Date(p.created_at).toLocaleString('ko-KR') : '-';
                    html += '<div class="detail-record">'
                        + '<span class="detail-r-char">' + p.char + '</span>'
                        + '<span class="detail-r-info">정답 ' + (p.correct||0) + ' / 오답 ' + (p.mistakes||0) + '</span>'
                        + '<span class="detail-r-time">' + timeStr + '</span>'
                        + '</div>';
                });
            }
            html += '</div>';
            panel.innerHTML = html;
        })
        .catch(function(e) {
            panel.innerHTML = '<div style="color:var(--danger);padding:20px;">로딩 실패: ' + e.message
                + '<br><button class="btn btn-sm btn-outline" style="margin-top:10px;" onclick="document.getElementById(\'learnerDetail\').style.display=\'none\'">닫기</button></div>';
        });
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

    // ===== INIT ON LOAD =====
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() { setTimeout(initAuth, 100); });
    } else {
        setTimeout(initAuth, 100);
    }
})();
