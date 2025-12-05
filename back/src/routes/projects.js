const express = require('express');
const { getDb } = require('../sqlite');
const { generateCourseStub, generateCourse } = require('../services/aiService');

const router = express.Router();

router.post('/', (req, res) => {
  const db = getDb();
  const { title, description, meta, topic, audience, goal, format, visuals, tests, videos, metaPrompt } = req.body;
  
  // Формируем meta объект из всех переданных данных
  const metaData = meta || {};
  if (topic) metaData.topic = topic;
  if (audience) metaData.audience = audience;
  if (goal) metaData.goal = goal;
  if (format) metaData.format = format;
  if (visuals !== undefined) metaData.visuals = visuals;
  if (tests !== undefined) metaData.tests = tests;
  if (videos !== undefined) metaData.videos = videos;
  if (metaPrompt) metaData.metaPrompt = metaPrompt;
  
  const stmt = db.prepare('INSERT INTO projects (title, description, meta) VALUES (?, ?, ?)');
  const info = stmt.run(title || 'Untitled', description || '', JSON.stringify(metaData));
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(info.lastInsertRowid);
  
  // Парсим meta для удобства фронтенда
  if (project.meta) {
    try {
      project.meta = JSON.parse(project.meta);
      // Добавляем поля напрямую в проект для совместимости
      if (project.meta.topic) project.topic = project.meta.topic;
      if (project.meta.audience) project.audience = project.meta.audience;
      if (project.meta.goal) project.goal = project.meta.goal;
    } catch (e) {
      // Если не JSON, оставляем как есть
    }
  }
  
  res.json(project);
});

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all();
  res.json(rows);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  // Парсим meta и добавляем поля напрямую для совместимости
  if (project.meta) {
    try {
      const meta = JSON.parse(project.meta);
      if (meta.topic) project.topic = meta.topic;
      if (meta.audience) project.audience = meta.audience;
      if (meta.goal) project.goal = meta.goal;
      if (meta.format) project.format = meta.format;
      if (meta.visuals !== undefined) project.visuals = meta.visuals;
      if (meta.tests !== undefined) project.tests = meta.tests;
      if (meta.videos !== undefined) project.videos = meta.videos;
    } catch (e) {
      // Если не JSON, игнорируем
    }
  }

  const modules = db.prepare('SELECT * FROM modules WHERE project_id = ? ORDER BY position').all(project.id);
  const lessons = db.prepare('SELECT * FROM lessons WHERE module_id IN (SELECT id FROM modules WHERE project_id = ?) ORDER BY position').all(project.id);
  
  // Форматируем lessons для фронтенда: оборачиваем content в объект {text: ...}
  const formattedLessons = lessons.map(lesson => ({
    ...lesson,
    content: lesson.content ? { text: lesson.content } : { text: '' }
  }));
  
  // Распределяем уроки по модулям
  const modulesWithLessons = modules.map(module => ({
    ...module,
    lessons: formattedLessons.filter(lesson => lesson.module_id === module.id)
  }));
  
  project.modules = modulesWithLessons;
  project.lessons = formattedLessons;
  res.json(project);
});

router.post('/:id/generate', async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const meta = JSON.parse(project.meta || '{}');
  const generated = await generateCourseStub(meta);

  const insertModule = db.prepare('INSERT INTO modules (project_id, title, position) VALUES (?, ?, ?)');
  const insertLesson = db.prepare('INSERT INTO lessons (module_id, title, content, position) VALUES (?, ?, ?, ?)');

  const tx = db.transaction((generated) => {
    generated.modules.forEach((m, mi) => {
      const info = insertModule.run(project.id, m.title, mi);
      const mid = info.lastInsertRowid;
      (m.lessons || []).forEach((l, li) => {
        insertLesson.run(mid, l.title, l.content || '', li);
      });
    });
  });

  tx(generated);
  db.prepare('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('generated', project.id);
  res.json({ ok: true });
});

router.post('/:id/generate-real', async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const meta = JSON.parse(project.meta || '{}');
  try {
    const generated = await generateCourse(meta, { projectId: project.id, type: 'real' });

    const insertModule = db.prepare('INSERT INTO modules (project_id, title, position) VALUES (?, ?, ?)');
    const insertLesson = db.prepare('INSERT INTO lessons (module_id, title, content, position) VALUES (?, ?, ?, ?)');
    const tx = db.transaction((generated) => {
      (generated.modules || []).forEach((m, mi) => {
        const info = insertModule.run(project.id, m.title, mi);
        const mid = info.lastInsertRowid;
        (m.lessons || []).forEach((l, li) => {
          // формируем content: берем content + examples (вставляем как текст)
          let content = l.content || '';
          if (Array.isArray(l.examples) && l.examples.length) {
            content += '\n\nПримеры:\n' + l.examples.map((e, idx) => `${idx+1}. ${e}`).join('\n');
          }
          insertLesson.run(mid, l.title, content, li);
        });
      });
    });

    tx(generated);
    db.prepare('UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run('generated', project.id);
    res.json({ ok: true, modules: generated.modules.length });
  } catch (err) {
    console.error('AI generation error:', err);
    return res.status(500).json({
      error: 'generation_failed',
      message: err.message,
      details: err.details || null,
      raw: err.raw || null
    });
  }
});

// POST /api/projects/:id/generate-preview
router.post('/:id/generate-preview', async (req, res) => {
  const db = getDb();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'not found' });

  const meta = JSON.parse(project.meta || '{}');
  try {
    const generated = await generateCourse(meta, { projectId: project.id, type: 'preview' });
    return res.json({ ok: true, generated });
  } catch (err) {
    console.error('AI preview error:', err);
    return res.status(500).json({
      error: 'preview_failed',
      message: err.message,
      details: err.details || null,
      raw: err.raw || null
    });
  }
});

// PATCH /api/projects/:projectId/lessons/:lessonId
router.patch('/:projectId/lessons/:lessonId', (req, res) => {
  const db = getDb();
  const { projectId, lessonId } = req.params;
  const { content } = req.body;

  // Проверяем, что урок принадлежит проекту
  const lesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) {
    return res.status(404).json({ error: 'Lesson not found' });
  }

  const module = db.prepare('SELECT * FROM modules WHERE id = ?').get(lesson.module_id);
  if (!module || module.project_id !== parseInt(projectId)) {
    return res.status(404).json({ error: 'Lesson not found in this project' });
  }

  // Обновляем контент урока
  // Если content.text - сохраняем как текст, иначе сохраняем весь content как JSON
  const contentText = content?.text || (typeof content === 'string' ? content : JSON.stringify(content));
  db.prepare('UPDATE lessons SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(contentText, lessonId);

  const updatedLesson = db.prepare('SELECT * FROM lessons WHERE id = ?').get(lessonId);
  // Форматируем для фронтенда: если content - строка, оборачиваем в объект
  if (updatedLesson.content && typeof updatedLesson.content === 'string') {
    updatedLesson.content = { text: updatedLesson.content };
  }
  
  res.json(updatedLesson);
});

// GET /api/projects/:projectId/progress
router.get('/:projectId/progress', (req, res) => {
  const db = getDb();
  const { projectId } = req.params;

  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  // Подсчитываем прогресс генерации
  const modules = db.prepare('SELECT COUNT(*) as count FROM modules WHERE project_id = ?').get(projectId);
  const lessons = db.prepare(`
    SELECT COUNT(*) as count 
    FROM lessons 
    WHERE module_id IN (SELECT id FROM modules WHERE project_id = ?)
  `).get(projectId);

  const moduleCount = modules.count || 0;
  const lessonCount = lessons.count || 0;

  // Определяем статус и прогресс
  let percent = 0;
  let step = 'Ожидание';

  if (project.status === 'generated') {
    percent = 100;
    step = 'Генерация завершена';
  } else if (moduleCount > 0 || lessonCount > 0) {
    // Если есть модули или уроки, значит генерация идет
    percent = Math.min(50 + (lessonCount * 2), 95);
    step = `Создано модулей: ${moduleCount}, уроков: ${lessonCount}`;
  } else if (project.status === 'draft') {
    percent = 10;
    step = 'Подготовка к генерации';
  }

  res.json({
    percent,
    step,
    modules: moduleCount,
    lessons: lessonCount,
    status: project.status
  });
});

module.exports = router;

