const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { getDynamicPointsMap } = require('../utils/scoring');

const router = express.Router();

// Phải khớp CONTEST_END bên routes/challenges.js.
const CONTEST_END = new Date('2026-07-23T00:00:00+07:00');

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const user = await queryOne(
      'SELECT id, username, display_name, role, avatar, created_at FROM users WHERE id = $1',
      [req.user.uid]
    );
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

    // Điểm chính thức: chỉ tính solve trước CONTEST_END, dùng điểm ĐỘNG live
    // (khớp scoreboard.js), không phải điểm gốc cố định của challenge.
    const pointsMap = await getDynamicPointsMap(CONTEST_END);

    // Danh sách hiển thị cho chính chủ: vẫn show TẤT CẢ (kể cả solve sau giờ kết thúc,
    // để họ theo dõi tiến độ "luyện tập"), nhưng đánh dấu counted=false cho phần không tính điểm.
    const solvedRows = await query(
      `SELECT c.id, c.title, c.category, c.points, s.solved_at, (s.solved_at < $2) AS counted
       FROM solves s JOIN challenges c ON c.id = s.challenge_id
       WHERE s.user_id = $1 ORDER BY s.solved_at DESC`,
      [user.id, CONTEST_END]
    );
    // Với solve được tính điểm, hiện điểm động thật; với solve "luyện tập" sau giờ kết
    // thúc, hiện điểm gốc chỉ để tham khảo (không cộng vào score).
    const solved = solvedRows.map((r) => ({
      ...r,
      points: r.counted ? (pointsMap.get(r.id) ?? r.points) : r.points,
    }));
    const score = solved.filter((r) => r.counted).reduce((sum, r) => sum + r.points, 0);
    const solved_count = solved.filter((r) => r.counted).length;

    const created = await query(
      'SELECT id, title, category, points, created_at FROM challenges WHERE created_by = $1 ORDER BY created_at DESC',
      [user.id]
    );

    res.json({
      user,
      score,
      solved_count,
      solved,
      created,
    });
  } catch (e) {
    next(e);
  }
});

// ---- Xem profile công khai của người khác (điểm, số bài đã giải) ----
// Không trả về thông tin nhạy cảm (không có password_hash, không có email nếu có, v.v.)
router.get('/view/:username', requireAuth, async (req, res, next) => {
  try {
    const user = await queryOne(
      'SELECT id, username, display_name, avatar, role, created_at FROM users WHERE username = $1',
      [req.params.username]
    );
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

    // Điểm công khai cũng chỉ tính solve trước CONTEST_END, dùng điểm ĐỘNG live,
    // khớp với scoreboard.js và profile của chính chủ.
    const pointsMap = await getDynamicPointsMap(CONTEST_END);

    // Danh sách bài đã giải hiện công khai: chỉ nên show phần ĐƯỢC TÍNH ĐIỂM
    // (tránh lộ ra rằng người đó có "solve luyện tập" sau giờ kết thúc — không cần thiết cho người ngoài xem).
    const solvedRows = await query(
      `SELECT c.id, c.title, c.category, c.points, s.solved_at
       FROM solves s JOIN challenges c ON c.id = s.challenge_id
       WHERE s.user_id = $1 AND s.solved_at < $2 ORDER BY s.solved_at DESC`,
      [user.id, CONTEST_END]
    );
    const solved = solvedRows.map((r) => ({ ...r, points: pointsMap.get(r.id) ?? r.points }));
    const score = solved.reduce((sum, r) => sum + r.points, 0);
    const solved_count = solved.length;

    res.json({
      user: {
        username: user.username,
        display_name: user.display_name,
        avatar: user.avatar,
        created_at: user.created_at,
      },
      score,
      solved_count,
      solved,
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