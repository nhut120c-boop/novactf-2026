const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET || 'challenge-files';

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  throw new Error('Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong biến môi trường.');
}

// service_role key CHỈ dùng ở phía server (Netlify Function), không bao giờ
// gửi ra frontend — vì key này bỏ qua toàn bộ Row Level Security.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const ALLOWED_EXT = new Set([
  '.zip', '.txt', '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.pcap',
  '.pcapng', '.py', '.c', '.cpp', '.bin', '.exe', '.jar', '.apk', '.7z', '.gz', '.md',
]);
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB (Netlify Function payload có giới hạn ~ vài chục MB)

async function uploadChallengeFile(file) {
  // file: object multer memoryStorage { buffer, originalname, size, mimetype }
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    const err = new Error('Định dạng file không được phép');
    err.status = 400;
    throw err;
  }
  if (file.size > MAX_FILE_SIZE) {
    const err = new Error('File quá lớn (tối đa 20MB)');
    err.status = 400;
    throw err;
  }

  const objectPath = `${crypto.randomBytes(16).toString('hex')}${ext}`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(objectPath, file.buffer, { contentType: file.mimetype, upsert: false });

  if (error) throw new Error('Upload file lên Supabase Storage thất bại: ' + error.message);
  return objectPath;
}

async function getSignedDownloadUrl(objectPath) {
  // Bucket để private -> phải tạo signed URL có hạn (5 phút) mỗi lần tải,
  // không lộ được đường dẫn public vĩnh viễn.
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(objectPath, 300);
  if (error) throw new Error('Không tạo được link tải file: ' + error.message);
  return data.signedUrl;
}

async function deleteChallengeFile(objectPath) {
  if (!objectPath) return;
  await supabase.storage.from(BUCKET).remove([objectPath]);
}

module.exports = { uploadChallengeFile, getSignedDownloadUrl, deleteChallengeFile, BUCKET };
