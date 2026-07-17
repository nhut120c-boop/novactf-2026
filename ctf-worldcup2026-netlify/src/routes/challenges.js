const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const sanitizeHtml = require('sanitize-html');

const { query, queryOne } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { hashFlag, verifyFlag } = require('../utils/flag');
const { uploadChallengeFile, getSignedDownloadUrl, deleteChallengeFile } = require('../utils/storage');

const router = express.Router();

// Giờ mở giải, dùng ĐỒNG HỒ SERVER (không tin thời gian client gửi lên).
// Đổi ở đây nếu cần dời ngày — nhớ giữ khớp với UNLOCK_AT/CONTEST_END bên
// app.js, announcements.js, và bot-solver.js (nếu có dùng).
const UNLOCK_AT = new Date('2026-07-21T08:00:00+07:00');
const CONTEST_END = new Date('2026-07-23T00:00:00+07:00');

function isUnlocked() {
  return Date.now() >= UNLOCK_AT.getTime();
}
function isEnded() {
  return Date.now() >= CONTEST_END.getTime();
}
// Trước giờ mở: user thường luôn bị chặn; admin chỉ được nếu là CHỦ challenge đó.
function isPreStartBlocked(role, isOwner) {
  if (role === 'admin') return !isOwner;
  return true;
}
// Lưu ý: sau CONTEST_END, KHÔNG chặn nộp flag/tải file — vẫn cho làm tự do,
// chỉ là điểm số từ lúc này trở đi sẽ không được tính vào bảng xếp hạng
// (xử lý ở routes/scoreboard.js và routes/profile.js, lọc theo solved_at < CONTEST_END).

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Chỉ admin mới được thực hiện thao tác này' });
  next();
}

// Netlify Functions không có ổ đĩa bền -> nhận file vào bộ nhớ (buffer) rồi
// đẩy thẳng lên Supabase Storage, không ghi ra filesystem cục bộ.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.user?.uid || req.ip}`,
  message: { error: 'Bạn nộp flag quá nhanh, chờ một chút rồi thử lại.' },
});

function cleanText(str, maxLen) {
  const trimmed = sanitizeHtml(String(str || ''), { allowedTags: [], allowedAttributes: {} }).trim();
  return trimmed.slice(0, maxLen);
}

// ---- Danh sách challenge (không bao giờ trả flag_hash/flag_salt ra ngoài) ----
router.get('/', requireAuth, async (req, res, next) => {
  try {
    // Trước giờ mở giải: user thường không thấy gì; admin chỉ thấy bài của chính mình
    // (kể cả metadata như title/category), tuyệt đối không thấy bài của admin khác.
    if (!isUnlocked() && req.user.role !== 'admin') {
      return res.json({ challenges: [], locked: true, unlockAt: UNLOCK_AT.toISOString() });
    }

    const ownOnlyClause = !isUnlocked() ? 'AND c.created_by = $2' : '';
    const params = !isUnlocked() ? [req.user.uid, req.user.uid] : [req.user.uid];

    const rows = await query(
      `SELECT c.id, c.title, c.description, c.category, c.points, c.difficulty,
              c.file_name, c.link, c.created_at, c.created_by, u.display_name AS author, u.username AS author_username,
              EXISTS(SELECT 1 FROM solves s WHERE s.challenge_id = c.id AND s.user_id = $1) AS solved,
              (SELECT COUNT(*) FROM solves s2 WHERE s2.challenge_id = c.id) AS solve_count
       FROM challenges c
       JOIN users u ON u.id = c.created_by
       WHERE c.is_visible = true ${ownOnlyClause}
       ORDER BY c.created_at DESC`,
      params
    );
    res.json({
      challenges: rows,
      locked: !isUnlocked(),
      unlockAt: UNLOCK_AT.toISOString(),
      contestEnd: CONTEST_END.toISOString(),
      ended: isEnded(),
    });
  } catch (e) {
    next(e);
  }
});

// ---- Tạo challenge mới: CHỈ ADMIN ----
router.post(
  '/',
  requireAuth,
  requireAdmin,
  upload.single('file'),
  [
    body('title').custom((v) => cleanText(v, 120).length >= 3).withMessage('Tiêu đề tối thiểu 3 ký tự'),
    body('description').custom((v) => cleanText(v, 5000).length >= 5).withMessage('Mô tả tối thiểu 5 ký tự'),
    body('category').custom((v) => cleanText(v, 40).length >= 2).withMessage('Chọn category'),
    body('points').isInt({ min: 10, max: 1000 }).withMessage('Điểm từ 10-1000'),
    body('flag').isLength({ min: 3, max: 256 }).withMessage('Flag không hợp lệ'),
    body('link')
      .optional({ checkFalsy: true })
      .isURL({ protocols: ['http', 'https'], require_protocol: true })
      .withMessage('Link không hợp lệ (phải bắt đầu bằng http:// hoặc https://)')
      .isLength({ max: 500 }),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      const title = cleanText(req.body.title, 120);
      const description = cleanText(req.body.description, 5000);
      const category = cleanText(req.body.category, 40);
      const difficulty = ['easy', 'medium', 'hard'].includes(req.body.difficulty) ? req.body.difficulty : 'medium';
      const points = parseInt(req.body.points, 10);
      const link = req.body.link ? cleanText(req.body.link, 500) : null;

      // Băm flag ngay lập tức, KHÔNG bao giờ lưu / log plaintext flag ở bất kỳ đâu.
      const { salt, hash } = hashFlag(req.body.flag);

      let filePath = null;
      let fileName = null;
      if (req.file) {
        filePath = await uploadChallengeFile(req.file); // upload lên Supabase Storage
        fileName = cleanText(req.file.originalname, 255);
      }

      const inserted = await queryOne(
        `INSERT INTO challenges
           (title, description, category, points, difficulty, flag_salt, flag_hash, file_path, file_name, link, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [title, description, category, points, difficulty, salt, hash, filePath, fileName, link, req.user.uid]
      );

      res.json({ ok: true, id: inserted.id });
    } catch (e) {
      if (e.status) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  }
);

// ---- Tải file đính kèm: tạo signed URL có hạn 5 phút từ Supabase Storage ----
router.get('/:id/file', requireAuth, async (req, res, next) => {
  try {
    const chall = await queryOne(
      'SELECT file_path, file_name, created_by FROM challenges WHERE id = $1 AND is_visible = true',
      [req.params.id]
    );
    if (!chall || !chall.file_path) return res.status(404).json({ error: 'Không có file' });

    const isOwner = chall.created_by === req.user.uid;
    if (!isUnlocked() && isPreStartBlocked(req.user.role, isOwner)) {
      return res.status(403).json({ error: 'Challenge chưa được mở' });
    }

    const url = await getSignedDownloadUrl(chall.file_path);
    res.redirect(url);
  } catch (e) {
    next(e);
  }
});

// ---- Nộp flag ----
router.post(
  '/:id/submit',
  requireAuth,
  submitLimiter,
  [body('flag').isString().isLength({ min: 1, max: 256 })],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: 'Flag không hợp lệ' });

      const chall = await queryOne('SELECT * FROM challenges WHERE id = $1 AND is_visible = true', [req.params.id]);
      if (!chall) return res.status(404).json({ error: 'Không tìm thấy challenge' });

      if (!isUnlocked() && chall.created_by !== req.user.uid) {
        return res.status(403).json({ error: 'Challenge chưa được mở' });
      }

      const already = await queryOne('SELECT 1 FROM solves WHERE user_id = $1 AND challenge_id = $2', [
        req.user.uid,
        chall.id,
      ]);
      if (already) return res.json({ ok: true, alreadySolved: true, message: 'Bạn đã giải challenge này rồi!' });

      const correct = verifyFlag(req.body.flag, chall.flag_salt, chall.flag_hash);

      await query('INSERT INTO submit_attempts (user_id, challenge_id, correct) VALUES ($1,$2,$3)', [
        req.user.uid,
        chall.id,
        correct,
      ]);

      if (!correct) return res.json({ ok: true, correct: false, message: 'Sai flag rồi, thử lại nhé!' });

      await query('INSERT INTO solves (user_id, challenge_id) VALUES ($1,$2)', [req.user.uid, chall.id]);
      res.json({ ok: true, correct: true, message: `Chính xác! +${chall.points} điểm` });
    } catch (e) {
      next(e);
    }
  }
);

// ---- Xóa challenge: chỉ chủ bài hoặc admin ----
// ---- Danh sách người đã giải + thời gian ----
router.get('/:id/solvers', requireAuth, async (req, res, next) => {
  try {
    const chall = await queryOne(
      'SELECT id, created_by FROM challenges WHERE id = $1 AND is_visible = true',
      [req.params.id]
    );
    if (!chall) return res.status(404).json({ error: 'Không tìm thấy challenge' });

    if (!isUnlocked() && chall.created_by !== req.user.uid) {
      return res.status(403).json({ error: 'Challenge chưa được mở' });
    }

    const rows = await query(
      `SELECT u.display_name, u.avatar, u.username, s.solved_at
       FROM solves s JOIN users u ON u.id = s.user_id
       WHERE s.challenge_id = $1
       ORDER BY s.solved_at ASC`,
      [chall.id]
    );
    res.json({ solvers: rows });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const chall = await queryOne('SELECT * FROM challenges WHERE id = $1', [req.params.id]);
    if (!chall) return res.status(404).json({ error: 'Không tìm thấy' });
    if (chall.created_by !== req.user.uid && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Không có quyền xóa bài này' });
    }
    if (chall.file_path) await deleteChallengeFile(chall.file_path);
    await query('DELETE FROM challenges WHERE id = $1', [chall.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;