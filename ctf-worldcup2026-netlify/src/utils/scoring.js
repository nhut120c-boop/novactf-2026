const { query } = require('../db');

// PHẢI khớp 100% với SCORING/calcDynamicPoints ở public/js/app.js.
// Nếu đổi 1 bên mà quên đổi bên kia -> số hiển thị trên card và số điểm thật
// (submit message + scoreboard) sẽ lệch nhau y hệt bug đã gặp trước đây.
const SCORING = {
  minimum: 100, // điểm sàn
  decay: 20,    // decay càng nhỏ -> điểm rơi càng nhanh theo số solve
};

function calcDynamicPoints(initialPoints, solveCount) {
  const { minimum, decay } = SCORING;
  if (initialPoints <= minimum) return minimum;
  if (!solveCount || solveCount <= 0) return initialPoints;
  const value = Math.floor(((minimum - initialPoints) / (decay * decay)) * (solveCount * solveCount) + initialPoints);
  return Math.max(minimum, value);
}

// Trả về Map<challengeId, dynamicPoints> tính LIVE dựa trên số lượt giải HỢP LỆ
// (solved_at < cutoff). Dùng chung cho scoreboard.js và profile.js để đảm bảo
// mọi nơi hiển thị điểm đều đồng nhất, không lệch nhau.
async function getDynamicPointsMap(cutoff) {
  const rows = await query(
    `SELECT c.id, c.points AS base_points,
            (SELECT COUNT(*) FROM solves s WHERE s.challenge_id = c.id AND s.solved_at < $1) AS solve_count
     FROM challenges c`,
    [cutoff]
  );
  const map = new Map();
  for (const r of rows) {
    map.set(r.id, calcDynamicPoints(r.base_points, Number(r.solve_count)));
  }
  return map;
}

module.exports = { SCORING, calcDynamicPoints, getDynamicPointsMap };
