// Chống CSRF kiểu "custom header check":
// - Cookie phiên đăng nhập đặt SameSite=Lax => trình duyệt KHÔNG gửi cookie
//   trong các request POST/PUT/DELETE bắt nguồn từ site khác.
// - Thêm lớp thứ 2: mọi request thay đổi dữ liệu bắt buộc phải có header
//   X-Requested-With, mà một <form> HTML thuần từ site khác không thể tự
//   gắn header này vào được (chỉ JS same-origin/fetch của app mới làm được).
function csrfHeaderCheck(req, res, next) {
  const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
  if (safeMethods.includes(req.method)) return next();

  const marker = req.get('X-Requested-With');
  if (marker !== 'CTFApp') {
    return res.status(403).json({ error: 'Yêu cầu không hợp lệ (thiếu header bảo vệ CSRF)' });
  }
  next();
}

module.exports = { csrfHeaderCheck };
