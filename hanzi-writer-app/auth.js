// auth.js - Authentication, Admin, and Learning History Module
(function() {
    'use strict';

    var firebaseEnabled = false;
    var currentUser = null;
    var isAdmin = false;
    var db = null;
    var authInstance = null;

    // ===== INIT =====
    function initAuth() {
        if (typeof FIREBASE_CONFIG !== 'undefined' && FIREBASE_CONFIG.apiKey) {
            try {
                firebase.initializeApp(FIREBASE_CONFIG);
                authInstance = firebase.auth();
                db = firebase.firestore();
                firebaseEnabled = true;
                authInstance.onAuthStateChanged(handleAuthStateChange);
            } catch(e) {
                console.warn('Firebase init failed:', e);
            }
        }
        updateAuthUI();
    }

    function handleAuthStateChange(user) {
        currentUser = user;
        if (user) {
            saveUserProfile(user);
            loadMyStats();
        }
        updateAuthUI();
    }

    // ===== GOOGLE AUTH =====
    window.googleLogin = function() {
        if (!firebaseEnabled) {
            if (typeof showToast === 'function') showToast('Firebase 설정이 필요합니다 (firebase-config.js)');
            return;
        }
        var provider = new firebase.auth.GoogleAuthProvider();
        authInstance.signInWithPopup(provider).catch(function(error) {
            if (typeof showToast === 'function') showToast('로그인 실패: ' + error.message);
        });
    };

    window.googleLogout = function() {
        if (authInstance) authInstance.signOut();
        currentUser = null;
        isAdmin = false;
        document.getElementById('myStatsSection').style.display = 'none';
        updateAuthUI();
    };

    function saveUserProfile(user) {
        if (!db) return;
        db.collection('users').doc(user.uid).set({
            name: user.displayName || '',
            email: user.email || '',
            photoURL: user.photoURL || '',
            lastActive: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }

    // ===== PRACTICE RECORD =====
    window.savePracticeRecord = function(char, correct, mistakes) {
        var record = {
            char: char,
            correct: correct || 0,
            mistakes: mistakes || 0,
            timestamp: new Date().toISOString()
        };

        // Always save to localStorage
        var records = JSON.parse(localStorage.getItem('practice_records') || '[]');
        records.push(record);
        if (records.length > 2000) records = records.slice(-2000);
        localStorage.setItem('practice_records', JSON.stringify(records));

        // Save to Firestore if logged in
        if (db && currentUser) {
            db.collection('users').doc(currentUser.uid)
                .collection('practices').add({
                    char: record.char,
                    correct: record.correct,
                    mistakes: record.mistakes,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
            db.collection('users').doc(currentUser.uid).update({
                lastActive: firebase.firestore.FieldValue.serverTimestamp()
            });
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

        // Recent records
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
        if (pw === 'aura09#$') {
            isAdmin = true;
            closeAdminModal();
            showAdminPanel();
        } else {
            if (typeof showToast === 'function') showToast('비밀번호가 틀립니다');
        }
    };

    window.exitAdmin = function() {
        isAdmin = false;
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

    function loadAllLearners() {
        var listEl = document.getElementById('learnerTableBody');
        var noticeEl = document.getElementById('adminNotice');
        var summaryEl = document.getElementById('adminSummary');

        if (!firebaseEnabled || !db) {
            noticeEl.style.display = 'block';
            noticeEl.innerHTML = '<span style="color:var(--warning);">Firebase 미설정</span> — firebase-config.js에 Firebase 프로젝트 정보를 입력하면 모든 학습자 데이터를 확인할 수 있습니다.'
                + '<br><br>현재 이 브라우저의 로컬 데이터만 표시됩니다.';
            showLocalAdminData(listEl, summaryEl);
            return;
        }

        noticeEl.style.display = 'none';
        listEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-dim);">로딩 중...</td></tr>';

        db.collection('users').orderBy('lastActive', 'desc').get().then(function(snapshot) {
            if (snapshot.empty) {
                listEl.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-dim);">등록된 학습자가 없습니다</td></tr>';
                summaryEl.innerHTML = '총 학습자: 0명';
                return;
            }

            summaryEl.innerHTML = '총 학습자: <strong>' + snapshot.size + '</strong>명';
            var html = '';
            var promises = [];

            snapshot.forEach(function(doc) {
                promises.push(
                    db.collection('users').doc(doc.id).collection('practices').orderBy('timestamp','desc').limit(1).get()
                        .then(function(pSnap) {
                            return { user: doc, practiceCount: pSnap.size, data: doc.data(), id: doc.id };
                        })
                );
            });

            // Simpler: just show user data, load practice count on detail view
            html = '';
            snapshot.forEach(function(doc) {
                var d = doc.data();
                var lastActive = d.lastActive ? d.lastActive.toDate().toLocaleDateString('ko-KR') : '-';
                var avatar = d.photoURL ? '<img class="admin-avatar" src="' + d.photoURL + '" onerror="this.style.display=\'none\'">' : '<div class="admin-avatar-placeholder">?</div>';
                html += '<tr>'
                    + '<td>' + avatar + '</td>'
                    + '<td>' + (d.name || '-') + '</td>'
                    + '<td>' + (d.email || '-') + '</td>'
                    + '<td>' + lastActive + '</td>'
                    + '<td><button class="btn btn-sm btn-outline" onclick="viewLearnerDetail(\'' + doc.id + '\')">상세보기</button></td>'
                    + '</tr>';
            });
            listEl.innerHTML = html;
        }).catch(function(e) {
            listEl.innerHTML = '<tr><td colspan="5" style="color:var(--danger);padding:20px;">로딩 실패: ' + e.message + '</td></tr>';
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
        if (!db) return;
        var panel = document.getElementById('learnerDetail');
        panel.style.display = 'block';
        panel.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-dim);">로딩 중...</div>';

        Promise.all([
            db.collection('users').doc(uid).get(),
            db.collection('users').doc(uid).collection('practices').orderBy('timestamp', 'desc').limit(200).get()
        ]).then(function(results) {
            var userDoc = results[0];
            var practicesSnap = results[1];
            var ud = userDoc.data();

            var totalCorrect = 0, totalMistakes = 0, charSet = new Set();
            var practiceList = [];

            practicesSnap.forEach(function(doc) {
                var d = doc.data();
                totalCorrect += d.correct || 0;
                totalMistakes += d.mistakes || 0;
                charSet.add(d.char);
                practiceList.push(d);
            });

            var accuracy = totalCorrect + totalMistakes > 0
                ? Math.round(totalCorrect / (totalCorrect + totalMistakes) * 100) : 0;

            var html = '<div class="detail-header">'
                + '<div class="detail-profile">'
                + (ud.photoURL ? '<img class="detail-avatar" src="' + ud.photoURL + '">' : '')
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
                    var timeStr = p.timestamp ? p.timestamp.toDate().toLocaleString('ko-KR') : '-';
                    html += '<div class="detail-record">'
                        + '<span class="detail-r-char">' + p.char + '</span>'
                        + '<span class="detail-r-info">정답 ' + (p.correct||0) + ' / 오답 ' + (p.mistakes||0) + '</span>'
                        + '<span class="detail-r-time">' + timeStr + '</span>'
                        + '</div>';
                });
            }
            html += '</div>';

            panel.innerHTML = html;
        }).catch(function(e) {
            panel.innerHTML = '<div style="color:var(--danger);padding:20px;">로딩 실패: ' + e.message + '<br><button class="btn btn-sm btn-outline" style="margin-top:10px;" onclick="document.getElementById(\'learnerDetail\').style.display=\'none\'">닫기</button></div>';
        });
    };

    // ===== UI UPDATE =====
    function updateAuthUI() {
        var loginBtn = document.getElementById('googleLoginBtn');
        var userInfo = document.getElementById('navUserInfo');
        var adminBadge = document.getElementById('adminBadge');

        if (!loginBtn || !userInfo) return;

        if (currentUser) {
            loginBtn.style.display = 'none';
            userInfo.style.display = 'flex';
            var avatar = document.getElementById('navUserAvatar');
            var name = document.getElementById('navUserName');
            if (avatar) avatar.src = currentUser.photoURL || '';
            if (name) name.textContent = currentUser.displayName || currentUser.email || '';
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
