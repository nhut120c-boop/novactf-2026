// netlify/functions/bot-solver.js
// Scheduled Function của Netlify — tự chạy định kỳ, KHÔNG có URL public để gọi thủ công.
// Nếu require('../../src/db') báo lỗi sai đường dẫn, đổi lại cho khớp cấu trúc thật của bạn
// (nguyên tắc: từ netlify/functions/ đi ra 2 cấp là tới gốc project, rồi vào src/db).
const { query, queryOne } = require('../../src/db');

// PHẢI khớp UNLOCK_AT ở src/routes/challenges.js, src/routes/announcements.js, và public/js/app.js.
const UNLOCK_AT = new Date('2026-07-21T08:00:00+07:00');
function isUnlocked() {
  return Date.now() >= UNLOCK_AT.getTime();
}

// Khuyến nghị (không bắt buộc): thêm ràng buộc unique để tránh trường hợp hiếm
// 2 lần chạy job chồng nhau tạo solve trùng cho cùng 1 bot + challenge:
//   ALTER TABLE solves ADD CONSTRAINT uq_solves_user_challenge UNIQUE (user_id, challenge_id);
// (Nếu bảng chưa có ràng buộc này, cứ để vậy cũng không sao — rủi ro trùng cực thấp
// vì mỗi lần chạy job đều tự check đã solve chưa trước khi insert.)

// Xác suất MỖI bot sẽ solve 1 bài trong MỖI lần chạy job này.
// Với schedule chạy mỗi 10 phút và ~15% cơ hội/bot, trung bình mỗi bot solve
// khoảng 1 bài / ~1h — rải rác tự nhiên, không dồn cục.
const SOLVE_CHANCE_PER_RUN = 0.15;
// Chặn trên số solve tối đa trong 1 lần chạy, tránh dồn cục nếu server nghỉ lâu rồi chạy bù.
const MAX_SOLVES_PER_RUN = 5;

async function handler() {
  if (!isUnlocked()) {
    return { statusCode: 200, body: 'Giải chưa mở, bot chưa hoạt động.' };
  }

  const bots = await query('SELECT id FROM users WHERE is_bot = true', []);
  if (bots.length === 0) {
    return { statusCode: 200, body: 'Không có bot nào trong DB.' };
  }

  const challenges = await query('SELECT id FROM challenges WHERE is_visible = true', []);
  if (challenges.length === 0) {
    return { statusCode: 200, body: 'Chưa có challenge nào.' };
  }

  // Xáo trộn thứ tự bot mỗi lần chạy để không ưu tiên bot đầu danh sách.
  const shuffledBots = [...bots].sort(() => Math.random() - 0.5);

  let solvesThisRun = 0;
  for (const bot of shuffledBots) {
    if (solvesThisRun >= MAX_SOLVES_PER_RUN) break;
    if (Math.random() > SOLVE_CHANCE_PER_RUN) continue;

    const alreadySolved = await query('SELECT challenge_id FROM solves WHERE user_id = $1', [bot.id]);
    const solvedIds = new Set(alreadySolved.map((r) => r.challenge_id));
    const remaining = challenges.filter((c) => !solvedIds.has(c.id));
    if (remaining.length === 0) continue; // bot này đã solve hết rồi

    const pick = remaining[Math.floor(Math.random() * remaining.length)];

    // Jitter thời gian solve trong khoảng 0-9 phút trước hiện tại, để "solved_at"
    // không trùng y hệt lúc job chạy, trông tự nhiên hơn khi lên solvers-list.
    const jitterMs = Math.floor(Math.random() * 9 * 60 * 1000);
    const solvedAt = new Date(Date.now() - jitterMs);

    await query(
      'INSERT INTO solves (user_id, challenge_id, solved_at) VALUES ($1, $2, $3)',
      [bot.id, pick.id, solvedAt]
    );
    solvesThisRun++;
  }

  return { statusCode: 200, body: `Bot đã solve thêm ${solvesThisRun} bài trong lần chạy này.` };
}

module.exports.handler = handler;
// Cú pháp Scheduled Function của Netlify — chạy mỗi 10 phút.
// Đổi cron nếu muốn thưa/dày hơn (vd "*/30 * * * *" = mỗi 30 phút).
module.exports.config = { schedule: '*/10 * * * *' };