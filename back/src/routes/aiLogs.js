const express = require('express');
const { getDb } = require('../sqlite');

const router = express.Router();

// GET /api/ai-logs - получить логи AI
router.get('/', (req, res) => {
  const db = getDb();
  const projectId = req.query.projectId;
  const limit = parseInt(req.query.limit) || 20;

  let query = 'SELECT * FROM ai_logs';
  const params = [];

  if (projectId) {
    query += ' WHERE project_id = ?';
    params.push(projectId);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const logs = db.prepare(query).all(...params);
  
  // Парсим JSON поля
  const parsedLogs = logs.map(log => ({
    ...log,
    request_meta: log.request_meta ? JSON.parse(log.request_meta) : null,
    parsed_candidate: log.parsed_candidate ? JSON.parse(log.parsed_candidate) : null
  }));

  res.json(parsedLogs);
});

module.exports = router;

