const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getDynamicPointsMap } = require('../utils/scoring');

const router = express.Router();

// Phải khớp CONTEST_END bên routes/challenges.js.
const CONTEST_END = new Date('2026-07-23T00:00:00+07:00');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    // Điểm động: mỗi challenge trị giá bao nhiêu phụ thuộc số lượt giải HỢP LỆ
    // hiện tại (tính LIVE mỗi lần load trang, không lưu cứng trong DB) — công thức
    // dùng chung ở src/utils/scoring.js, khớp với public/js/app.js.
    const pointsMap = await getDynamicPointsMap(CONTEST_END);

    const users = await query('SELECT id, username, display_name, avatar FROM users');
    const solves = await query(
      `SELECT user_id, challenge_id, solved_at FROM solves WHERE solved_at < $1`,
      [CONTEST_END]
    );

    const agg = new Map();
    for (const u of users) {
      agg.set(u.id, {
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        avatar: u.avatar,
        score: 0,
        solved_count: 0,
        last_solve: null,
      });
    }
    for (const s of solves) {
      const entry = agg.get(s.user_id);
      if (!entry) continue; // user đã bị xoá nhưng solve còn sót lại (không nên xảy ra, phòng hờ)
      entry.score += pointsMap.get(s.challenge_id) || 0;
      entry.solved_count += 1;
      if (!entry.last_solve || new Date(s.solved_at) > new Date(entry.last_solve)) {
        entry.last_solve = s.solved_at;
      }
    }

    const rows = [...agg.values()].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ta = a.last_solve ? new Date(a.last_solve).getTime() : Infinity;
      const tb = b.last_solve ? new Date(b.last_solve).getTime() : Infinity;
      return ta - tb;
    });

    res.json({ scoreboard: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;