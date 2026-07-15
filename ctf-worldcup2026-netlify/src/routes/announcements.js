const express = require('express');
const { body, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');

const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Phải khớp UNLOCK_AT bên challenges.js
const UNLOCK_AT = new Date('2026-07-21T08:00:00+07:00');
function isUnlocked() {
  return Date.now() >= UNLOCK_AT.getTime();
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới được thực hiện thao tác này' });
  next();
}

function cleanText(str, maxLen) {
  return sanitizeHtml(String(str || ''), { allowedTags: [], allowedAttributes: {} }).trim().slice(0, maxLen);
}

// ---- Danh sách thông báo/hint ----
// - Thông báo chung (challenge_id = null): ai cũng thấy.
// - Hint gắn theo challenge: chỉ thấy nếu challenge đó đang hiển thị được với user này
//   (đã mở giải, HOẶC user là admin và chính là chủ challenge đó).
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const unlocked = isUnlocked();
    const rows = await query(
      `SELECT a.id, a.message, a.created_at, a.challenge_id,
              c.title AS challenge_title, c.created_by AS challenge_owner
       FROM announcements a
       LEFT JOIN challenges c ON c.id = a.challenge_id
       WHERE a.challenge_id IS NULL
          OR $2 = true
          OR c.created_by = $1
       ORDER BY a.created_at DESC`,
      [req.user.uid, unlocked]
    );
    res.json({ announcements: rows });
  } catch (e) {
    next(e);
  }
});

// ---- Đăng thông báo/hint: chỉ admin ----
// Nếu gắn challengeId: chỉ được gắn vào challenge do CHÍNH admin đó tạo
// (kể cả sau khi mở giải cũng vậy — không đăng hint hộ bài của admin khác).
router.post(
  '/',
  requireAuth,
  requireAdmin,
  [
    body('message').custom((v) => cleanText(v, 1000).length >= 2).withMessage('Nội dung tối thiểu 2 ký tự'),
    body('challengeId').optional({ checkFalsy: true }).isInt().withMessage('Challenge không hợp lệ'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      const message = cleanText(req.body.message, 1000);
      let challengeId = null;

      if (req.body.challengeId) {
        const chall = await queryOne('SELECT created_by FROM challenges WHERE id = $1', [req.body.challengeId]);
        if (!chall) return res.status(404).json({ error: 'Không tìm thấy challenge' });
        if (chall.created_by !== req.user.uid) {
          return res.status(403).json({ error: 'Bạn chỉ được gắn hint vào challenge do chính bạn tạo' });
        }
        challengeId = req.body.challengeId;
      }

      const inserted = await queryOne(
        'INSERT INTO announcements (message, challenge_id, created_by) VALUES ($1,$2,$3) RETURNING id, created_at',
        [message, challengeId, req.user.uid]
      );

      res.json({ ok: true, id: inserted.id, created_at: inserted.created_at });
    } catch (e) {
      next(e);
    }
  }
);

// ---- Xóa thông báo: chỉ người đã đăng nó mới được xóa ----
router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const ann = await queryOne('SELECT * FROM announcements WHERE id = $1', [req.params.id]);
    if (!ann) return res.status(404).json({ error: 'Không tìm thấy' });
    if (ann.created_by !== req.user.uid) {
      return res.status(403).json({ error: 'Bạn chỉ được xóa thông báo do chính mình đăng' });
    }
    await query('DELETE FROM announcements WHERE id = $1', [ann.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
