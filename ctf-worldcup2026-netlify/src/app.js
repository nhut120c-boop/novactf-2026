require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');

const { csrfHeaderCheck } = require('./middleware/csrf');
const authRoutes = require('./routes/auth');
const challengeRoutes = require('./routes/challenges');
const scoreboardRoutes = require('./routes/scoreboard');
const profileRoutes = require('./routes/profile');
const announcementRoutes = require('./routes/announcements');

const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(cookieParser());

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(csrfHeaderCheck);

app.use('/api/auth', authRoutes);
app.use('/api/challenges', challengeRoutes);
app.use('/api/scoreboard', scoreboardRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/announcements', announcementRoutes);

// Khi chạy local (node server.js) mới cần tự serve static; trên Netlify,
// Netlify tự serve thư mục public/ nên các route này không được gọi tới.
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  if (err && err.message && err.message.includes('không được phép')) {
    return res.status(400).json({ error: err.message });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File quá lớn' });
  }
  console.error('Unhandled error:', err?.message);
  res.status(500).json({ error: 'Lỗi máy chủ, vui lòng thử lại sau' });
});

module.exports = app;
