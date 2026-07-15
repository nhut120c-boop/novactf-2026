# 🏆 CTF World Cup 2026 — bản Netlify + Supabase

Bản này dùng **Supabase** (Postgres + Storage) làm database & nơi lưu file đính kèm,
và chạy trên **Netlify** dưới dạng Netlify Functions (vì Netlify không có ổ đĩa bền,
không tự chạy được SQLite/lưu file cục bộ).

## Bước 1 — Tạo project Supabase

1. Vào https://supabase.com → **New project**. Đặt tên, chọn khu vực gần bạn, đặt mật khẩu DB (nhớ lưu lại).
2. Vào **SQL Editor** → New query → dán toàn bộ nội dung file `supabase-schema.sql` trong repo này → **Run**.
   (Tạo bảng `users`, `challenges`, `solves`, `submit_attempts`.)
3. Vào **Storage** → **New bucket** → đặt tên `challenge-files` → để **Private** (không public).
4. Vào **Project Settings → API**, lấy 2 giá trị:
   - `Project URL` → đây là `SUPABASE_URL`
   - `service_role` key (mục secret, **không phải** `anon` key) → đây là `SUPABASE_SERVICE_ROLE_KEY`
   ⚠️ `service_role` key có toàn quyền trên DB, tuyệt đối không để lộ ra frontend/git — nó chỉ nằm trong biến môi trường server.
5. Vào **Project Settings → Database → Connection string**, chọn tab **Connection pooling** (Transaction mode, cổng `6543`) → copy chuỗi kết nối, thay `[YOUR-PASSWORD]` bằng mật khẩu DB bạn đặt ở bước 1 → đây là `DATABASE_URL`.

## Bước 2 — Đẩy code lên GitHub

```bash
cd ctf-worldcup2026-netlify
git init
git add .
git commit -m "Init CTF World Cup 2026 - Netlify + Supabase edition"
```

Tạo repo mới trên https://github.com/new (để trống, không tick "Add README"), rồi:

```bash
git branch -M main
git remote add origin https://github.com/<username>/<ten-repo>.git
git push -u origin main
```

> `.env` đã nằm trong `.gitignore` nên sẽ KHÔNG bị đẩy lên GitHub — đúng như mong muốn, vì nó chứa secret.

## Bước 3 — Deploy lên Netlify

1. Vào https://app.netlify.com → **Add new site → Import an existing project** → chọn GitHub → chọn repo vừa tạo.
2. Netlify tự đọc `netlify.toml` (đã có sẵn trong repo) nên **không cần chỉnh build settings** — publish directory là `public`, functions là `netlify/functions`.
3. Trước khi deploy, vào **Site settings → Environment variables**, thêm đúng các biến sau (copy từ `.env.example`, điền giá trị thật của bạn):
   - `JWT_SECRET` (tự tạo chuỗi random dài, ví dụ chạy `openssl rand -hex 32`)
   - `DATABASE_URL` (chuỗi pooler Supabase ở Bước 1.5)
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_BUCKET` = `challenge-files`
   - `NODE_ENV` = `production`
4. Bấm **Deploy site**. Xong, Netlify sẽ cho bạn 1 domain dạng `random-name-123.netlify.app` (đổi tên được trong Site settings).
5. Từ giờ mỗi lần bạn `git push` lên nhánh `main`, Netlify tự build & deploy lại.

## Kiểm tra sau khi deploy

- Mở domain Netlify → thử đăng ký tài khoản đầu tiên (tự thành admin) → thử tab Challenge → Add Challenge → thử nộp flag.
- Nếu gặp lỗi 500, vào Netlify → **Functions** tab → xem log của function `api` để biết lỗi cụ thể (thường do sai `DATABASE_URL` hoặc chưa chạy `supabase-schema.sql`).

## Vì sao flag vẫn không ai xem lại được (kể cả trên Supabase)?

Giữ nguyên cơ chế cũ: flag được băm một chiều bằng `scrypt` + salt ngẫu nhiên riêng từng challenge
**trước khi** lưu vào Supabase. Bảng `challenges` trong Supabase chỉ có cột `flag_salt`/`flag_hash`
(chuỗi hash), không có cột nào chứa plaintext flag. Dù bạn có toàn quyền admin trên Supabase project,
mở Table Editor lên cũng chỉ thấy hash, không thể đảo ngược ra flag gốc.

Ngoài ra bảng `users`/`challenges`/`solves` đều đã bật **Row Level Security** và không có policy nào
cho `anon`/`authenticated` — chỉ `service_role` (dùng trong Netlify Function, không lộ ra frontend)
mới đọc/ghi được, nên kể cả lỡ để lộ `anon key` cũng không ai đọc trộm được dữ liệu qua Supabase API trực tiếp.

## Chạy thử ở máy local (không deploy)

```bash
npm install
cp .env.example .env   # điền đủ các biến ở Bước 1
npm start
```
Mở `http://localhost:3000`.

## Các lớp bảo mật

- Mật khẩu người dùng: bcrypt (cost 12), không lưu plaintext
- Flag challenge: scrypt một chiều + salt riêng từng flag
- Session: JWT trong cookie httpOnly, SameSite=Lax, hết hạn 12h
- Chống CSRF: SameSite=Lax + bắt buộc header `X-Requested-With` cho request thay đổi dữ liệu
- Chống SQL Injection: toàn bộ query dùng parameterized query (`pg`, placeholder `$1,$2...`)
- Chống XSS: frontend dùng `textContent` hiển thị dữ liệu người dùng, backend sanitize input trước khi lưu
- Chống brute-force đăng nhập: rate limit theo IP + khóa tài khoản 15 phút sau 8 lần sai
- Chống dò flag tự động: rate limit 8 lần nộp/phút/user/challenge
- Upload file: whitelist định dạng, giới hạn 20MB, upload thẳng vào Supabase Storage (bucket private), tải về qua signed URL có hạn 5 phút
- Row Level Security trên toàn bộ bảng Supabase — chỉ service_role mới truy cập được
- HTTP headers: helmet (CSP, chống clickjacking...)
- Rate limit toàn cục chống spam/DoS cơ bản

## Cấu trúc thư mục

```
netlify.toml                 # cấu hình Netlify (publish/functions/redirects)
netlify/functions/api.js     # wrap Express app thành Netlify Function
server.js                    # chạy local (node server.js) — không dùng khi deploy Netlify
src/app.js                   # Express app (routes, middleware) dùng chung
src/db.js                    # kết nối Postgres (Supabase) qua pg Pool
src/utils/flag.js            # hash/verify flag một chiều
src/utils/storage.js         # upload/tải file qua Supabase Storage
src/middleware/auth.js        # xác thực JWT
src/middleware/csrf.js        # chống CSRF
src/routes/                  # auth, challenges, scoreboard, profile
public/                       # frontend tĩnh (Netlify serve trực tiếp)
supabase-schema.sql           # chạy 1 lần trong Supabase SQL Editor
```
