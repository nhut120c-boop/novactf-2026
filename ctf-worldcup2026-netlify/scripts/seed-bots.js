// Chạy 1 LẦN DUY NHẤT bằng: node scripts/seed-bots.js
// (đặt file này vào thư mục scripts/ ở gốc project, ngang hàng với src/)
//
// Script này tự tạo 30 tài khoản "bot" trong bảng users, đánh dấu is_bot = true.
// Bot KHÔNG đăng nhập được (password random, không ai biết) — chỉ tồn tại để
// netlify/functions/bot-solver.js tự động cho chúng "solve" challenge định kỳ.

require('dotenv').config();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { query, queryOne } = require('../src/db');

const AVATARS = ['⚽', '🏆', '🥅', '🧤', '🟨', '🟥', '🎽', '🌎', '🦁', '🐐'];

// Tên hiển thị kiểu fan bóng đá / CTF cho hợp theme "CTF World Cup 2026" — tự do đổi nếu muốn.
const BOT_NAMES = [
  'Rồng Vàng', 'Sói Biển', 'Tia Chớp', 'Ẩn Danh FC', 'Ma Trận', 'Bão Đêm',
  'Cú Đêm', 'Ninja Code', 'Vệ Binh', 'Thợ Săn Bug', 'Ẩn Số', 'Kẻ Vô Hình',
  'Sấm Sét', 'Hắc Ưng', 'Bạch Hổ', 'Rừng Xanh', 'Mãnh Hổ', 'Cơn Lốc',
  'Người Nhện', 'Chiến Binh', 'Du Mục', 'Ẩn Sĩ', 'Kỵ Sĩ', 'Phù Thủy Code',
  'Người Sắt', 'Sói Đơn Độc', 'Rồng Lửa', 'Tia Sét', 'Người Máy', 'Ẩn Mình',
];

function randomUsername(i) {
  return `player${1000 + i}${crypto.randomBytes(2).toString('hex')}`;
}

async function main() {
  const existing = await queryOne('SELECT COUNT(*)::int AS c FROM users WHERE is_bot = true', []);
  if (existing.c > 0) {
    console.log(`Đã có ${existing.c} bot trong DB rồi. Dừng lại để tránh tạo trùng.`);
    console.log('Nếu muốn tạo thêm, sửa script hoặc xóa bot cũ trước: DELETE FROM users WHERE is_bot = true;');
    return;
  }

  for (let i = 0; i < BOT_NAMES.length; i++) {
    const username = randomUsername(i);
    const displayName = BOT_NAMES[i];
    const avatar = AVATARS[i % AVATARS.length];
    // Password ngẫu nhiên, không lưu lại ở đâu -> không ai đăng nhập được vào bot này.
    const randomPassword = crypto.randomBytes(24).toString('hex');
    const passwordHash = bcrypt.hashSync(randomPassword, 12);

    await query(
      `INSERT INTO users (username, password_hash, display_name, role, avatar, is_bot)
       VALUES ($1, $2, $3, 'member', $4, true)`,
      [username, passwordHash, displayName, avatar]
    );
    console.log(`Đã tạo bot: ${displayName} (${username})`);
  }

  console.log(`\nXong! Đã tạo ${BOT_NAMES.length} bot.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Lỗi khi seed bot:', e);
    process.exit(1);
  });