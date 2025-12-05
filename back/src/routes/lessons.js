const express = require('express');
const { getDb } = require('../sqlite');

const router = express.Router();

// POST /api/lessons/:lessonId/improve
router.post('/:lessonId/improve', async (req, res) => {
  const db = getDb();
  const { lessonId } = req.params;
  const { action } = req.body;

  if (!['simplify', 'shorten', 'expand'].includes(action)) {
    return res.status(400).json({ error: 'Invalid action. Must be: simplify, shorten, or expand' });
  }

  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) {
    return res.status(404).json({ error: 'Lesson not found' });
  }

  try {
    // Динамически импортируем Gemini клиент
    const { callGeminiText } = await import('../services/geminiClient.mjs');
    
    const currentContent = lesson.content || '';
    
    // Формируем промпт в зависимости от действия
    let prompt = '';
    switch (action) {
      case 'simplify':
        prompt = `Упрости следующий текст урока, сделав его более понятным и доступным, но сохранив основную информацию:\n\n${currentContent}`;
        break;
      case 'shorten':
        prompt = `Сократи следующий текст урока, оставив только самое важное:\n\n${currentContent}`;
        break;
      case 'expand':
        prompt = `Расширь следующий текст урока, добавив больше деталей, примеров и объяснений:\n\n${currentContent}`;
        break;
    }

    // Вызываем Gemini API
    const improvedContent = await callGeminiText(prompt, {
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      maxOutputTokens: 4000,
      temperature: 0.7
    });

    // Обновляем урок в БД
    // Проверяем наличие колонки updated_at и используем соответствующий запрос
    const tableInfo = db.prepare("PRAGMA table_info(lessons)").all();
    const hasUpdatedAt = tableInfo.some(col => col.name === 'updated_at');
    
    if (hasUpdatedAt) {
      db.prepare('UPDATE lessons SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(improvedContent, lessonId);
    } else {
      // Если колонки нет, добавляем её
      try {
        db.prepare('ALTER TABLE lessons ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP').run();
        console.log('Added updated_at column to lessons table');
      } catch (e) {
        // Игнорируем если колонка уже существует
      }
      db.prepare('UPDATE lessons SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(improvedContent, lessonId);
    }

    const updatedLesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
    
    // Форматируем для фронтенда
    if (updatedLesson.content && typeof updatedLesson.content === 'string') {
      updatedLesson.content = { text: updatedLesson.content };
    }

    res.json({
      ok: true,
      lesson: updatedLesson,
      action
    });
  } catch (error) {
    console.error('Error improving lesson:', error);
    res.status(500).json({
      error: 'improvement_failed',
      message: error.message
    });
  }
});

module.exports = router;

