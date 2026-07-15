const state = {
  user: null,
  challenges: [],
  currentCategory: 'all',
  activeChallengeId: null,
};

// ---- Helper gọi API ----
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
  try { data = await res.json(); } catch (e) { }
  if (!res.ok) throw new Error(data.error || 'Có lỗi xảy ra');
  return data;
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  setTimeout(() => t.classList.add('hidden'), 2600);
}

// ---------------- AUTH & ROLE ----------------
function onAuthSuccess(user) {
  state.user = user;
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-name').textContent = user.displayName;
  
  // Kiểm tra quyền: Chỉ admin mới thấy nút Add Challenge
  const addBtn = document.getElementById('open-add-chall');
  if (user.role === 'admin') {
    addBtn.classList.remove('hidden');
  } else {
    addBtn.classList.add('hidden');
  }
  
  initApp();
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  try {
    const data = await api('/auth/login', { method: 'POST', body: { username, password } });
    onAuthSuccess(data.user);
  } catch (e) { document.getElementById('login-error').textContent = e.message; }
});

document.getElementById('register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const displayName = document.getElementById('reg-displayname').value.trim();
  const username = document.getElementById('reg-username').value.trim();
  const password = document.getElementById('reg-password').value;
  try {
    const data = await api('/auth/register', { method: 'POST', body: { displayName, username, password } });
    onAuthSuccess(data.user);
  } catch (e) { document.getElementById('register-error').textContent = e.message; }
});

document.getElementById('logout-btn').onclick = async () => {
  await api('/auth/logout', { method: 'POST' });
  location.reload();
};

async function checkSession() {
  try {
    const data = await api('/auth/me');
    onAuthSuccess({ username: data.user.username, displayName: data.user.display_name, role: data.user.role });
    document.getElementById('user-avatar').textContent = data.user.avatar || '👾';
  } catch (e) { }
}

// ---------------- NAVIGATION ----------------
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

function initApp() { switchView('rules'); }

// ---------------- CHALLENGES ----------------
async function loadChallenges() {
  const data = await api('/challenges');
  state.challenges = data.challenges;
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
  const list = state.challenges.filter(c => state.currentCategory === 'all' || c.category === state.currentCategory);
  
  list.forEach((c) => {
    const card = document.createElement('div');
    card.className = 'chall-card' + (c.solved ? ' solved' : '');
    card.innerHTML = `
      ${c.solved ? '<span class="solved-check">✅</span>' : ''}
      <span class="badge-cat">${c.category}</span>
      <h4>${c.title}</h4>
      <div class="meta-row"><span>by ${c.author}</span><span class="points-badge">${c.points} pts</span></div>
    `;
    card.onclick = () => openChallengeModal(c);
    grid.appendChild(card);
  });
}

function openChallengeModal(c) {
  state.activeChallengeId = c.id;
  document.getElementById('modal-category').textContent = c.category;
  document.getElementById('modal-title').textContent = c.title;
  document.getElementById('modal-desc').textContent = c.description;
  document.getElementById('chall-modal').classList.remove('hidden');
}

document.getElementById('chall-modal-close').onclick = () => document.getElementById('chall-modal').classList.add('hidden');

document.getElementById('submit-flag-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const flag = document.getElementById('flag-input').value;
  try {
    const data = await api(`/challenges/${state.activeChallengeId}/submit`, { method: 'POST', body: { flag } });
    const resBox = document.getElementById('submit-result');
    resBox.textContent = data.message;
    resBox.className = 'submit-result ' + (data.correct ? 'ok' : 'bad');
    if (data.correct) { showToast('⚽ GOAL!'); loadChallenges(); }
  } catch (e) { document.getElementById('submit-result').textContent = e.message; }
});

// ---------------- ADD CHALLENGE (Admin Only) ----------------
document.getElementById('open-add-chall').onclick = () => document.getElementById('add-modal').classList.remove('hidden');
document.getElementById('add-modal-close').onclick = () => document.getElementById('add-modal').classList.add('hidden');

document.getElementById('add-chall-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append('title', document.getElementById('c-title').value);
  fd.append('category', document.getElementById('c-category').value);
  fd.append('difficulty', document.getElementById('c-difficulty').value);
  fd.append('points', document.getElementById('c-points').value);
  fd.append('description', document.getElementById('c-desc').value);
  fd.append('flag', document.getElementById('c-flag').value);
  
  try {
    await api('/challenges', { method: 'POST', body: fd, isForm: true });
    document.getElementById('add-modal').classList.add('hidden');
    showToast('🚀 Đã triển khai Challenge mới!');
    loadChallenges();
  } catch (e) { document.getElementById('add-chall-error').textContent = e.message; }
});

// ---------------- INIT ----------------
checkSession();