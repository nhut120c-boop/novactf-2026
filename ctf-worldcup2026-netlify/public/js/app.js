const state = {
  user: null,
  challenges: [],
  currentCategory: 'all',
  activeChallengeId: null,
};

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

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
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
  initApp();
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

function initApp() {
  switchView('rules');
}

// ---------------- CHALLENGES ----------------
async function loadChallenges() {
  const data = await api('/challenges');
  // nếu backend tự tính điểm động thì gán c.dynamic = false để giữ nguyên c.points
  state.challenges = data.challenges.map((c) => ({
    ...c,
    displayPoints: c.dynamic === false ? c.points : calcDynamicPoints(c.points, c.solve_count || 0),
  }));
  renderCategories();
  renderChallenges();
}

function renderCategories() {
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
  document.getElementById('flag-input').value = '';
  const resultBox = document.getElementById('submit-result');
  resultBox.textContent = '';
  resultBox.className = 'submit-result';
  if (c.solved) resultBox.textContent = '✅ Bạn đã giải challenge này rồi.';
  document.getElementById('chall-modal').classList.remove('hidden');
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
    tr.children[1].textContent = `${row.avatar || '⚽'} ${row.display_name}`;
    tr.children[2].textContent = row.score;
    tr.children[3].textContent = row.solved_count;
    tbody.appendChild(tr);
  });
}

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
    li.children[0].textContent = s.title;
    li.children[1].textContent = `+${s.points}`;
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