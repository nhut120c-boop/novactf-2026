const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { query, queryOne } = require('../db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

const isProd = process.env.NODE_ENV === 'production';
const cookieOpts = {
  httpOnly: true,
  secure: isProd, // Netlify luôn chạy HTTPS -> nên set NODE_ENV=production trên Netlify
  sameSite: 'lax',
  maxAge: 12 * 60 * 60 * 1000,
};

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Thử đăng nhập quá nhiều lần, vui lòng thử lại sau ít phút.' },
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const USERNAME_RE = /^[a-zA-Z0-9_]{3,32}$/;

router.post(
  '/register',
  registerLimiter,
  [
    body('username').trim().matches(USERNAME_RE).withMessage('Username 3-32 ký tự, chỉ chữ/số/gạch dưới'),
    body('password').isLength({ min: 8, max: 128 }).withMessage('Mật khẩu tối thiểu 8 ký tự'),
    body('displayName').trim().isLength({ min: 1, max: 64 }).withMessage('Tên hiển thị 1-64 ký tự'),
  ],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

      const { username, password, displayName } = req.body;

      const existing = await queryOne('SELECT id FROM users WHERE username = $1', [username]);
      if (existing) return res.status(409).json({ error: 'Username đã tồn tại' });

      const passwordHash = bcrypt.hashSync(password, 12);
      const countRow = await queryOne('SELECT COUNT(*)::int AS c FROM users', []);
      const role = countRow.c === 0 ? 'admin' : 'member'; // người đầu tiên đăng ký là admin

      const inserted = await queryOne(
        `INSERT INTO users (username, password_hash, display_name, role)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [username, passwordHash, displayName, role]
      );

      const user = { id: inserted.id, username, role };
      const token = signToken(user);
      res.cookie('token', token, cookieOpts);
      res.json({ ok: true, user: { username, displayName, role } });
    } catch (e) {
      next(e);
    }
  }
);

router.post(
  '/login',
  loginLimiter,
  [body('username').trim().notEmpty(), body('password').notEmpty()],
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) return res.status(400).json({ error: 'Sai thông tin đăng nhập' });

      const { username, password } = req.body;
      const user = await queryOne('SELECT * FROM users WHERE username = $1', [username]);

      const genericError = () => res.status(401).json({ error: 'Sai tên đăng nhập hoặc mật khẩu' });
      if (!user) return genericError();

      if (user.locked_until && new Date(user.locked_until) > new Date()) {
        return res.status(423).json({ error: 'Tài khoản tạm khóa do đăng nhập sai nhiều lần, thử lại sau.' });
      }

      const ok = bcrypt.compareSync(password, user.password_hash);
      if (!ok) {
        const fails = user.failed_logins + 1;
        let lockedUntil = null;
        if (fails >= 8) lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        await query('UPDATE users SET failed_logins = $1, locked_until = $2 WHERE id = $3', [
          fails,
          lockedUntil,
          user.id,
        ]);
        return genericError();
      }

      await query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);

      const token = signToken(user);
      res.cookie('token', token, cookieOpts);
      res.json({ ok: true, user: { username: user.username, displayName: user.display_name, role: user.role } });
    } catch (e) {
      next(e);
    }
  }
);

router.post('/logout', (req, res) => {
  res.clearCookie('token', { ...cookieOpts, maxAge: undefined });
  res.json({ ok: true });
});

router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const user = await queryOne(
      'SELECT id, username, display_name, role, avatar, created_at FROM users WHERE id = $1',
      [req.user.uid]
    );
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
    res.json({ user });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
