const state = {
  user: null,
  challenges: [],
  currentCategory: 'all',
  activeChallengeId: null,
};

// Thời điểm mở giải — dùng chung cho countdown VÀ logic khóa/mở challenge.
// LƯU Ý QUAN TRỌNG: đây chỉ là hiển thị. Việc khóa thật sự (không cho tải file,
// không cho submit flag, không cho admin xem bài của admin khác) BẮT BUỘC phải
// được kiểm tra ở server, vì ai cũng có thể gọi thẳng API mà bỏ qua giao diện này.
const UNLOCK_AT = '2026-07-21T08:00:00+07:00';
const CONTEST_END = '2026-07-23T00:00:00+07:00';

function isUnlocked() {
  return Date.now() >= new Date(UNLOCK_AT).getTime();
}
function isContestEnded() {
  return Date.now() >= new Date(CONTEST_END).getTime();
}

// điểm động: challenge càng nhiều solve càng giảm điểm, không bao giờ thấp hơn "minimum"
// công thức parabol kiểu CTFd: value = ((min - initial)/decay^2) * solves^2 + initial
const SCORING = {
  minimum: 100, // điểm sàn
  decay: 20,    // decay càng nhỏ -> điểm rơi càng nhanh theo số solve
};

function calcDynamicPoints(initialPoints, solveCount) {
  const { minimum, decay } = SCORING;
  if (initialPoints <= minimum) return minimum;
  if (!solveCount || solveCount <= 0) return initialPoints;
  const value = Math.floor(((minimum - initialPoints) / (decay * decay)) * (solveCount * solveCount) + initialPoints);
  return Math.max(minimum, value);
}

// ---- Helper gọi API, tự gắn header chống CSRF cho các method thay đổi dữ liệu ----
async function api(path, { method = 'GET', body, isForm = false } = {}) {
  const headers = {};
  if (method !== 'GET') headers['X-Requested-With'] = 'CTFApp';
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  const res = await fetch('/api' + path, {
    method,
    headers,
    credentials: 'same-origin',
    body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra');
  return data;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------------- AUTH ----------------
document.getElementById('tab-login-btn').onclick = () => switchAuthTab('login');
document.getElementById('tab-register-btn').onclick = () => switchAuthTab('register');

function switchAuthTab(tab) {
  document.getElementById('login-form').classList.toggle('hidden', tab !== 'login');
  document.getElementById('register-form').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login-btn').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register-btn').classList.toggle('active', tab === 'register');
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errBox = document.getElementById('login-error');
  errBox.textContent = '';
  try {
    const data = await api('/auth/login', { method: 'POST', body: { username, password } });
    onAuthSuccess(data.user);
  } catch (e) {
    errBox.textContent = e.message;
  }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const displayName = document.getElementById('reg-displayname').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  const errBox = document.getElementById('register-error');
  errBox.textContent = '';
  try {
    const data = await api('/auth/register', { method: 'POST', body: { displayName, username, password } });
    onAuthSuccess(data.user);
  } catch (e) {
    errBox.textContent = e.message;
  }
});

document.getElementById('logout-btn').onclick = async () => {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
};

function onAuthSuccess(user) {
  state.user = user;
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-name').textContent = user.displayName;
  document.getElementById('open-add-chall').classList.toggle('hidden', user.role !== 'admin');
  document.getElementById('open-add-announcement').classList.toggle('hidden', user.role !== 'admin');
  initApp();
  startCountdown(UNLOCK_AT);
}

// ---------------- COUNTDOWN ----------------
function startCountdown(deadlineStr) {
  const deadline = new Date(deadlineStr).getTime();
  const banner = document.getElementById('countdown-banner');
  const timerEl = document.getElementById('countdown-timer');
  if (!timerEl) return;

  function tick() {
    const diff = deadline - Date.now();
    updateFullLockOverlay(diff);
    if (diff <= 0) {
      timerEl.textContent = 'Giải đã mở!';
      banner.classList.add('ended');
      clearInterval(state._countdownHandle);
      // Vừa chuyển sang mở giải -> tự làm mới danh sách challenge, không cần F5 thủ công.
      const challengesView = document.getElementById('view-challenges');
      if (challengesView && !challengesView.classList.contains('hidden')) {
        loadChallenges();
      }
      return;
    }
    const d = Math.floor(diff / 86400000);
    const h = Math.floor((diff % 86400000) / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    const pad = (n) => String(n).padStart(2, '0');
    timerEl.textContent = `${d} ngày ${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  clearInterval(state._countdownHandle);
  tick();
  state._countdownHandle = setInterval(tick, 1000);
}

// Banner full-màn-hình che hết mọi thứ với member cho tới UNLOCK_AT.
// Admin luôn bỏ qua overlay này để còn vào quản lý/test trước giờ mở.
function updateFullLockOverlay(diff) {
  const overlay = document.getElementById('full-lock-overlay');
  if (!overlay) return;
  const shouldShow = state.user && state.user.role !== 'admin' && diff > 0;
  overlay.classList.toggle('hidden', !shouldShow);
  if (!shouldShow) return;
  const timerEl = document.getElementById('full-lock-timer');
  const d = Math.floor(diff / 86400000);
  const h = Math.floor((diff % 86400000) / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  const pad = (n) => String(n).padStart(2, '0');
  timerEl.textContent = `${d} ngày ${pad(h)}:${pad(m)}:${pad(s)}`;
}

async function checkSession() {
  try {
    const data = await api('/auth/me');
    onAuthSuccess({ username: data.user.username, displayName: data.user.display_name, role: data.user.role });
    document.getElementById('user-avatar').textContent = data.user.avatar || '⚽';
  } catch (e) {
    // chưa đăng nhập -> ở màn hình auth
  }
}

// ---------------- NAV ----------------
document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.onclick = () => switchView(btn.dataset.view);
});

function switchView(view) {
  document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('hidden', v.id !== 'view-' + view));
  if (view === 'challenges') loadChallenges();
  if (view === 'scoreboard') loadScoreboard();
  if (view === 'profile') loadProfile();
}

// Sau khi mở giải, nếu người dùng đang ở tab challenges thì tab đó tự loadChallenges()
// lại (xử lý trong startCountdown ở trên); switchView() ở đây chỉ lo phần điều hướng.

function initApp() {
  switchView('rules');
}

// ---------------- CHALLENGES ----------------
async function loadChallenges() {
  const data = await api('/challenges');
  const unlocked = isUnlocked();

  // Chỉ để UI phản ánh đúng trạng thái — server (/api/challenges) PHẢI tự lọc
  // theo đúng luật này (xem ghi chú ở cuối file), vì client-side filter ở đây
  // chỉ ẩn trên giao diện, không ngăn được ai gọi thẳng API.
  let visible = data.challenges;
  if (!unlocked) {
    visible = state.user.role === 'admin'
      ? data.challenges.filter((c) => c.author_username === state.user.username)
      : [];
  }

  // nếu backend tự tính điểm động thì gán c.dynamic = false để giữ nguyên c.points
  state.challenges = visible.map((c) => ({
    ...c,
    displayPoints: c.dynamic === false ? c.points : calcDynamicPoints(c.points, c.solve_count || 0),
  }));

  renderLockBanner(unlocked, data.challenges.length);
  renderCategories();
  renderChallenges();
  loadAnnouncements();
}

async function loadAnnouncements() {
  try {
    const data = await api('/announcements');
    renderAnnouncements(data.announcements);
    if (state.user.role === 'admin') populateAnnouncementChallengeSelect();
  } catch (e) {
    // im lặng nếu lỗi, không chặn trang challenges
  }
}

function renderAnnouncements(list) {
  const box = document.getElementById('announcement-list');
  box.innerHTML = '';
  list.forEach((a) => {
    const card = document.createElement('div');
    card.className = 'announcement-card';
    card.innerHTML = `
      <span class="ann-tag"></span>
      <div class="ann-msg"></div>
    `;
    card.querySelector('.ann-tag').textContent = a.challenge_id
      ? `🔎 Hint: ${a.challenge_title || 'challenge'}`
      : '📢 Thông báo chung';
    card.querySelector('.ann-msg').textContent = a.message;
    if (state.user.role === 'admin') {
      const delBtn = document.createElement('button');
      delBtn.className = 'ann-del';
      delBtn.textContent = '✕';
      delBtn.title = 'Xóa (chỉ xóa được thông báo do bạn đăng)';
      delBtn.onclick = async () => {
        try {
          await api(`/announcements/${a.id}`, { method: 'DELETE' });
          loadAnnouncements();
        } catch (e) {
          showToast(e.message);
        }
      };
      card.appendChild(delBtn);
    }
    box.appendChild(card);
  });
}

function populateAnnouncementChallengeSelect() {
  const sel = document.getElementById('ann-challenge');
  const current = sel.value;
  sel.innerHTML = '<option value="">🌐 Thông báo chung (toàn giải)</option>';
  // state.challenges lúc này (trước unlock) đã chỉ chứa bài của chính admin này rồi
  state.challenges.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `🔎 Hint cho: ${c.title}`;
    sel.appendChild(opt);
  });
  sel.value = current;
}

document.getElementById('open-add-announcement').onclick = () => {
  document.getElementById('add-announcement-modal').classList.remove('hidden');
};
document.getElementById('add-announcement-modal-close').onclick = () =>
  document.getElementById('add-announcement-modal').classList.add('hidden');

document.getElementById('add-announcement-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('add-announcement-error');
  errBox.textContent = '';
  const message = document.getElementById('ann-message').value;
  const challengeId = document.getElementById('ann-challenge').value || undefined;
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await api('/announcements', { method: 'POST', body: { message, challengeId } });
    document.getElementById('add-announcement-modal').classList.add('hidden');
    document.getElementById('add-announcement-form').reset();
    showToast('📢 Đã đăng thông báo!');
    loadAnnouncements();
  } catch (e) {
    errBox.textContent = e.message;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

function renderLockBanner(unlocked, totalCount) {
  let banner = document.getElementById('challenges-lock-notice');
  const grid = document.getElementById('challenge-grid');
  if (!banner) {
    banner = document.createElement('p');
    banner.id = 'challenges-lock-notice';
    banner.style.color = 'white';
    grid.parentNode.insertBefore(banner, grid);
  }
  if (unlocked) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
  if (state.user.role === 'admin') {
    banner.textContent = totalCount > 0
      ? '🔒 Giải chưa mở. Bạn chỉ thấy các challenge do chính bạn tạo, không thấy bài của admin khác.'
      : '🔒 Giải chưa mở. Bạn chưa tạo challenge nào.';
  } else {
    banner.textContent = '🔒 Challenge sẽ được mở khi đồng hồ đếm ngược về 0. Quay lại sau nhé!';
  }
}

// ---------------- WARM UP (chỉ ở client, KHÔNG lưu database) ----------------
// Đây chỉ là 1 câu hỏi vui để "mở khóa" giao diện xem toàn bộ challenge thật,
// không liên quan gì tới điểm/scoreboard/API — cố tình không đụng tới backend.
const WARMUP_KEY = 'novactf_warmup_solved';

function isWarmupSolved() {
  return localStorage.getItem(WARMUP_KEY) === '1';
}
function setWarmupSolved() {
  localStorage.setItem(WARMUP_KEY, '1');
}

function renderWarmupGate() {
  const grid = document.getElementById('challenge-grid');
  grid.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'chall-card warmup-card';
  card.innerHTML = `
    <h4>🔥 Khởi động</h4>
    <div class="meta-row"><span>by NovaCTF</span><span class="points-badge">Bắt buộc</span></div>
  `;
  card.onclick = openWarmupModal;
  grid.appendChild(card);

  const note = document.createElement('p');
  note.className = 'warmup-note';
  note.textContent = '👆 Làm xong challenge khởi động này để mở khóa toàn bộ challenge nhé!';
  grid.appendChild(note);
}

function openWarmupModal() {
  document.getElementById('warmup-question').classList.remove('hidden');
  document.getElementById('warmup-choices').classList.remove('hidden');
  const resultBox = document.getElementById('warmup-result');
  resultBox.textContent = '';
  resultBox.className = 'submit-result';
  document.getElementById('warmup-modal').classList.remove('hidden');
}

document.getElementById('warmup-modal-close').onclick = () =>
  document.getElementById('warmup-modal').classList.add('hidden');

document.getElementById('warmup-no').onclick = () => {
  setWarmupSolved();
  document.getElementById('warmup-question').classList.add('hidden');
  document.getElementById('warmup-choices').classList.add('hidden');
  const resultBox = document.getElementById('warmup-result');
  resultBox.className = 'submit-result ok';
  resultBox.textContent = '🐐 Chuẩn không cần chỉnh! Flag: NVR{ilove_CR7}';
  showToast('🔥 Đã mở khóa toàn bộ challenge!');
  renderCategories();
  renderChallenges();
};

document.getElementById('warmup-yes').onclick = () => {
  document.getElementById('warmup-modal').classList.add('hidden');
  showToast('🚫 Thích Messi thì mời về home!');
  switchView('rules');
};

function renderCategories() {
  if (!isWarmupSolved()) {
    document.getElementById('category-filter').innerHTML = '';
    return;
  }
  const cats = ['all', ...new Set(state.challenges.map((c) => c.category))];
  const box = document.getElementById('category-filter');
  box.innerHTML = '';
  cats.forEach((cat) => {
    const pill = document.createElement('button');
    pill.className = 'cat-pill' + (state.currentCategory === cat ? ' active' : '');
    pill.textContent = cat === 'all' ? 'Tất cả' : cat;
    pill.onclick = () => { state.currentCategory = cat; renderCategories(); renderChallenges(); };
    box.appendChild(pill);
  });
}

function renderChallenges() {
  if (!isWarmupSolved()) {
    renderWarmupGate();
    return;
  }
  const grid = document.getElementById('challenge-grid');
  grid.innerHTML = '';
  const list = state.challenges.filter(
    (c) => state.currentCategory === 'all' || c.category === state.currentCategory
  );
  if (list.length === 0) {
    grid.innerHTML = '<p style="color:white;">Chưa có challenge nào trong mục này. Hãy là người đầu tiên thêm! ⚽</p>';
    return;
  }
  list.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'chall-card' + (c.solved ? ' solved' : '');
    card.innerHTML = `
      ${c.solved ? '<span class="solved-check">✅</span>' : ''}
      <span class="badge-cat"></span>
      <h4></h4>
      <div class="meta-row"><span></span><span class="points-badge"></span></div>
    `;
    card.querySelector('.badge-cat').textContent = c.category;
    card.querySelector('h4').textContent = c.title;
    const metaSpans = card.querySelectorAll('.meta-row span');
    metaSpans[0].textContent = `by ${c.author} · ${c.solve_count} lượt giải`;
    metaSpans[1].textContent = `${c.displayPoints} pts`;
    card.onclick = () => openChallengeModal(c);
    grid.appendChild(card);
  });
}

function openChallengeModal(c) {
  state.activeChallengeId = c.id;
  document.getElementById('modal-category').textContent = c.category;
  document.getElementById('modal-title').textContent = c.title;
  document.getElementById('modal-meta').textContent = `${c.displayPoints} điểm · ${c.difficulty} · by ${c.author}`;
  document.getElementById('modal-desc').textContent = c.description;
  const fileLink = document.getElementById('modal-file');
  if (c.file_name) {
    fileLink.classList.remove('hidden');
    fileLink.href = `/api/challenges/${c.id}/file`;
    fileLink.textContent = `📎 Tải file: ${c.file_name}`;
  } else {
    fileLink.classList.add('hidden');
  }
  const linkEl = document.getElementById('modal-link');
  if (c.link) {
    linkEl.classList.remove('hidden');
    linkEl.href = c.link;
  } else {
    linkEl.classList.add('hidden');
  }
  document.getElementById('flag-input').value = '';
  const resultBox = document.getElementById('submit-result');
  resultBox.textContent = '';
  resultBox.className = 'submit-result';
  if (c.solved) resultBox.textContent = '✅ Bạn đã giải challenge này rồi.';
  document.getElementById('chall-modal').classList.remove('hidden');
  loadSolvers(c.id);
}

async function loadSolvers(challengeId) {
  const listEl = document.getElementById('solvers-list');
  const countEl = document.getElementById('solvers-count');
  listEl.innerHTML = '<li>Đang tải...</li>';
  try {
    const data = await api(`/challenges/${challengeId}/solvers`);
    countEl.textContent = data.solvers.length;
    listEl.innerHTML = '';
    if (data.solvers.length === 0) {
      listEl.innerHTML = '<li>Chưa ai giải được bài này</li>';
      return;
    }
    data.solvers.forEach((s) => {
      const li = document.createElement('li');
      li.innerHTML = `<span></span><span class="solve-time"></span>`;
      const nameSpan = li.children[0];
      nameSpan.textContent = `${s.avatar || '⚽'} ${s.display_name}`;
      nameSpan.className = 'scoreboard-name-link';
      nameSpan.onclick = () => openUserProfile(s.username);
      li.children[1].textContent = new Date(s.solved_at).toLocaleString('vi-VN');
      listEl.appendChild(li);
    });
  } catch (e) {
    listEl.innerHTML = '<li>Không tải được danh sách</li>';
  }
}

document.getElementById('chall-modal-close').onclick = () => document.getElementById('chall-modal').classList.add('hidden');

document.getElementById('submit-flag-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const flag = document.getElementById('flag-input').value;
  const resultBox = document.getElementById('submit-result');
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    const data = await api(`/challenges/${state.activeChallengeId}/submit`, { method: 'POST', body: { flag } });
    resultBox.textContent = data.message;
    resultBox.className = 'submit-result ' + (data.correct ? 'ok' : 'bad');
    if (data.correct) {
      showToast('⚽ GOAL! ' + data.message);
      loadChallenges();
    }
  } catch (e) {
    resultBox.textContent = e.message;
    resultBox.className = 'submit-result bad';
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

// ---- Add challenge ----
document.getElementById('open-add-chall').onclick = () => document.getElementById('add-modal').classList.remove('hidden');
document.getElementById('add-modal-close').onclick = () => document.getElementById('add-modal').classList.add('hidden');

document.getElementById('add-chall-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errBox = document.getElementById('add-chall-error');
  errBox.textContent = '';
  const fd = new FormData();
  fd.append('title', document.getElementById('c-title').value);
  fd.append('category', document.getElementById('c-category').value);
  fd.append('difficulty', document.getElementById('c-difficulty').value);
  fd.append('points', document.getElementById('c-points').value);
  fd.append('description', document.getElementById('c-desc').value);
  fd.append('flag', document.getElementById('c-flag').value);
  const linkVal = document.getElementById('c-link').value.trim();
  if (linkVal) fd.append('link', linkVal);
  const fileInput = document.getElementById('c-file');
  if (fileInput.files[0]) fd.append('file', fileInput.files[0]);

  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  try {
    await api('/challenges', { method: 'POST', body: fd, isForm: true });
    document.getElementById('add-modal').classList.add('hidden');
    document.getElementById('add-chall-form').reset();
    showToast('🎉 Đã thêm challenge mới!');
    loadChallenges();
  } catch (e) {
    errBox.textContent = e.message;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

// ---------------- SCOREBOARD ----------------
async function loadScoreboard() {
  const data = await api('/scoreboard');
  const tbody = document.getElementById('scoreboard-body');
  tbody.innerHTML = '';
  data.scoreboard.forEach((row, i) => {
    const tr = document.createElement('tr');
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1;
    tr.innerHTML = `<td></td><td></td><td></td><td></td>`;
    tr.children[0].textContent = medal;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'scoreboard-name-link';
    nameSpan.textContent = `${row.avatar || '⚽'} ${row.display_name}`;
    nameSpan.onclick = () => openUserProfile(row.username);
    tr.children[1].appendChild(nameSpan);
    tr.children[2].textContent = row.score;
    tr.children[3].textContent = row.solved_count;
    tbody.appendChild(tr);
  });
}

// ---------------- XEM PROFILE NGƯỜI KHÁC ----------------
async function openUserProfile(username) {
  try {
    const data = await api(`/profile/view/${encodeURIComponent(username)}`);
    document.getElementById('vp-avatar').textContent = data.user.avatar || '⚽';
    document.getElementById('vp-name').textContent = data.user.display_name;
    document.getElementById('vp-score').textContent = data.score;
    document.getElementById('vp-solved').textContent = data.solved_count;

    const list = document.getElementById('vp-solved-list');
    list.innerHTML = '';
    if (data.solved.length === 0) {
      list.innerHTML = '<li>Chưa giải challenge nào</li>';
    } else {
      data.solved.forEach((s) => {
        const li = document.createElement('li');
        li.innerHTML = `<span></span><span></span>`;
        li.children[0].textContent = s.title;
        li.children[1].textContent = `+${s.points}`;
        list.appendChild(li);
      });
    }
    document.getElementById('view-profile-modal').classList.remove('hidden');
  } catch (e) {
    showToast(e.message);
  }
}

document.getElementById('view-profile-modal-close').onclick = () =>
  document.getElementById('view-profile-modal').classList.add('hidden');

// ---------------- PROFILE ----------------
const AVATARS = ['⚽', '🏆', '🥅', '🧤', '🟨', '🟥', '🎽', '🌎', '🦁', '🐐'];

async function loadProfile() {
  const data = await api('/profile');
  document.getElementById('profile-avatar').textContent = data.user.avatar;
  document.getElementById('user-avatar').textContent = data.user.avatar;
  document.getElementById('profile-name').textContent = data.user.display_name;
  document.getElementById('profile-score').textContent = data.score;
  document.getElementById('profile-solved').textContent = data.solved_count;

  const picker = document.getElementById('avatar-picker');
  picker.innerHTML = '';
  AVATARS.forEach((a) => {
    const span = document.createElement('span');
    span.textContent = a;
    span.onclick = async () => {
      await api('/profile/avatar', { method: 'POST', body: { avatar: a } });
      document.getElementById('profile-avatar').textContent = a;
      document.getElementById('user-avatar').textContent = a;
    };
    picker.appendChild(span);
  });

  const solvedList = document.getElementById('solved-list');
  solvedList.innerHTML = '';
  if (data.solved.length === 0) solvedList.innerHTML = '<li>Chưa giải challenge nào</li>';
  data.solved.forEach((s) => {
    const li = document.createElement('li');
    li.innerHTML = `<span></span><span></span>`;
    li.children[0].textContent = s.counted === false ? `${s.title} (luyện tập, không tính điểm)` : s.title;
    li.children[1].textContent = `+${s.points}`;
    if (s.counted === false) li.style.opacity = '0.55';
    solvedList.appendChild(li);
  });

  const createdList = document.getElementById('created-list');
  createdList.innerHTML = '';
  if (data.created.length === 0) createdList.innerHTML = '<li>Chưa tạo challenge nào</li>';
  data.created.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = `<span></span><span></span>`;
    li.children[0].textContent = c.title;
    li.children[1].textContent = `${c.points} pts`;
    createdList.appendChild(li);
  });
}

document.getElementById('password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentPassword = document.getElementById('cur-pass').value;
  const newPassword = document.getElementById('new-pass').value;
  const errBox = document.getElementById('password-error');
  errBox.textContent = '';
  errBox.style.color = 'var(--success)';
  try {
    await api('/profile/change-password', { method: 'POST', body: { currentPassword, newPassword } });
    errBox.style.color = '#1fa34d';
    errBox.textContent = 'Đổi mật khẩu thành công!';
    document.getElementById('password-form').reset();
  } catch (e) {
    errBox.style.color = '#e5484d';
    errBox.textContent = e.message;
  }
});

// ---------------- INIT ----------------
checkSession();

/*
 * ============================================================
 * VIỆC BẮT BUỘC PHẢI LÀM Ở BACKEND (frontend không tự bảo mật được):
 * ============================================================
 * 1. GET /api/challenges
 *    - Nếu now < UNLOCK_AT (2026-07-25T00:00:00) VÀ user không phải admin
 *      -> trả về mảng rỗng (không trả cả metadata, kể cả title/category).
 *    - Nếu now < UNLOCK_AT VÀ user là admin
 *      -> chỉ trả các challenge có created_by = user hiện tại.
 *    - Nếu now >= UNLOCK_AT -> trả tất cả cho mọi user như bình thường.
 *
 * 2. GET /api/challenges/:id/file  (tải file đính kèm)
 *    - Áp đúng luật như trên: chặn 403 nếu chưa unlock và (không phải admin
 *      HOẶC là admin nhưng không phải chủ challenge đó).
 *
 * 3. POST /api/challenges/:id/submit (nộp flag)
 *    - Cũng chặn 403 theo luật như trên. Đừng chỉ dựa vào việc ẩn nút ở UI.
 *
 * 4. POST /api/challenges (tạo challenge)
 *    - Chỉ role admin được gọi (kiểm tra session, không tin req.body.role).
 *
 * 5. So sánh thời gian nên dùng giờ server (server-side clock), không tin
 *    thời gian client gửi lên, để tránh user chỉnh đồng hồ máy để mở khóa sớm.
 * ============================================================
 */