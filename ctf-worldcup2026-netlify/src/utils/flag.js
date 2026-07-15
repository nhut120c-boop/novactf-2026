const crypto = require('crypto');

const KEYLEN = 64;

/**
 * Băm flag một chiều bằng scrypt (giống bcrypt về mục đích, nhưng scrypt
 * built-in trong Node, không cần thư viện ngoài).
 * - Mỗi flag có 1 salt ngẫu nhiên riêng -> 2 challenge trùng flag vẫn ra hash khác nhau.
 * - KHÔNG có cách nào để đảo ngược hash -> salt ra lại plaintext flag.
 *   Kể cả người tạo web / có full quyền đọc source code + database cũng
 *   không thể biết được flag gốc là gì, chỉ có thể so sánh đúng/sai.
 */
function normalizeFlag(rawFlag) {
  // Trim khoảng trắng thừa đầu/cuối, giữ nguyên hoa/thường vì flag CTF
  // thường phân biệt hoa thường.
  return String(rawFlag).trim();
}

function hashFlag(rawFlag) {
  const flag = normalizeFlag(rawFlag);
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(flag, salt, KEYLEN).toString('hex');
  return { salt, hash };
}

function verifyFlag(rawFlag, salt, expectedHashHex) {
  const flag = normalizeFlag(rawFlag);
  const candidate = crypto.scryptSync(flag, salt, KEYLEN);
  const expected = Buffer.from(expectedHashHex, 'hex');
  if (candidate.length !== expected.length) return false;
  // So sánh an toàn, tránh timing attack
  return crypto.timingSafeEqual(candidate, expected);
}

module.exports = { hashFlag, verifyFlag, normalizeFlag };
