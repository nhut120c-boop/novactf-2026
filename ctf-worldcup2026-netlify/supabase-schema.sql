-- =========================================================
-- CTF World Cup 2026 - Supabase Postgres schema
-- Chạy toàn bộ file này 1 LẦN trong Supabase Dashboard
-- (Project → SQL Editor → New query → dán vào → Run)
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member', -- 'member' | 'admin'
  avatar        TEXT NOT NULL DEFAULT '⚽',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS challenges (
  id           BIGSERIAL PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL,
  category     TEXT NOT NULL,
  points       INTEGER NOT NULL DEFAULT 100,
  difficulty   TEXT NOT NULL DEFAULT 'medium',
  flag_salt    TEXT NOT NULL,
  flag_hash    TEXT NOT NULL,
  file_path    TEXT,           -- đường dẫn object trong Supabase Storage bucket
  file_name    TEXT,           -- tên file gốc để hiển thị / tải về
  created_by   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_visible   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS solves (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id  BIGINT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  solved_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, challenge_id)
);

CREATE TABLE IF NOT EXISTS submit_attempts (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge_id  BIGINT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  attempted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  correct       BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_solves_user   ON solves(user_id);
CREATE INDEX IF NOT EXISTS idx_solves_chall  ON solves(challenge_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user_chall_time ON submit_attempts(user_id, challenge_id, attempted_at);

-- Lưu ý bảo mật: app dùng service_role key ở phía server (Netlify Function)
-- để tự quản lý toàn bộ authz trong code Express, nên KHÔNG bật Row Level
-- Security phức tạp ở đây là bắt buộc — nhưng để phòng trường hợp lộ anon
-- key ra client, ta vẫn khóa các bảng lại, chỉ service_role mới đọc/ghi được.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE solves ENABLE ROW LEVEL SECURITY;
ALTER TABLE submit_attempts ENABLE ROW LEVEL SECURITY;
-- Không tạo policy nào cho anon/authenticated => mặc định chặn hết,
-- chỉ service_role (dùng trong Netlify Function, không lộ ra frontend) mới qua được.
