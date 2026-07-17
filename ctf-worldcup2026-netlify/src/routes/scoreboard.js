const express = require('express');
const { query } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Phải khớp CONTEST_END bên routes/challenges.js.
const CONTEST_END = new Date('2026-07-23T00:00:00+07:00');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT u.id, u.username, u.display_name, u.avatar,
              COALESCE(SUM(c.points), 0)::int AS score,
              COUNT(s.id)::int AS solved_count,
              MAX(s.solved_at) AS last_solve
       FROM users u
       LEFT JOIN solves s ON s.user_id = u.id AND s.solved_at < $1
       LEFT JOIN challenges c ON c.id = s.challenge_id
       GROUP BY u.id
       ORDER BY score DESC, last_solve ASC NULLS LAST`,
      [CONTEST_END]
    );
    res.json({ scoreboard: rows });
  } catch (e) {
    next(e);
  }
});

module.exports = router;