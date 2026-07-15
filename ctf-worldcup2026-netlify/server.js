// Dùng khi CHẠY LOCAL / self-host (npm start). Trên Netlify không dùng file
// này — Netlify gọi thẳng netlify/functions/api.js.
const app = require('./src/app');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏆 CTF World Cup 2026 dang chay tai http://localhost:${PORT}`);
});
