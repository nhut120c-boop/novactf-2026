const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = await queryOne(
      'SELECT id, username, display_name, role, avatar, created_at FROM users WHERE id = $1',
      [req.user.uid]
    );
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

    const scoreRow = await queryOne(
      `SELECT COALESCE(SUM(c.points),0)::int AS score, COUNT(*)::int AS solved_count
       FROM solves s JOIN challenges c ON c.id = s.challenge_id
       WHERE s.user_id = $1`,
      [user.id]
    );

    const solved = await query(
      `SELECT c.id, c.title, c.category, c.points, s.solved_at
       FROM solves s JOIN challenges c ON c.id = s.challenge_id
       WHERE s.user_id = $1 ORDER BY s.solved_at DESC`,
      [user.id]
    );

    const created = await query(
      'SELECT id, title, category, points, created_at FROM challenges WHERE created_by = $1 ORDER BY created_at DESC',
      [user.id]
    );

    res.json({
      user,
      score: scoreRow.score,
      solved_count: scoreRow.solved_count,
      solved,
      created,
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/change-password',
  requireAuth,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8, max: 128 }).withMessage('Mật khẩu mới tối thiểu 8 ký tự'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      const user = await queryOne('SELECT * FROM users WHERE id = $1', [req.user.uid]);
      const ok = bcrypt.compareSync(req.body.currentPassword, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'Mật khẩu hiện tại không đúng' });

      const newHash = bcrypt.hashSync(req.body.newPassword, 12);
      await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, user.id]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/avatar',
  requireAuth,
  [body('avatar').isString().isLength({ min: 1, max: 8 })],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: 'Avatar không hợp lệ' });
      await query('UPDATE users SET avatar = $1 WHERE id = $2', [req.body.avatar, req.user.uid]);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  }
);

module.exports = router;
