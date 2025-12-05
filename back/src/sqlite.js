const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(process.cwd(), 'db.sqlite');
let db = null;

function initDb() {
  if (db) return; // Уже инициализирована

  // Создаем БД если не существует
  db = new Database(DB_PATH);
  
  // Включаем foreign keys
  db.pragma('foreign_keys = ON');

  // Создаем таблицы если их нет
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      meta TEXT,
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS modules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      module_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT,
      position INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (module_id) REFERENCES modules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      type TEXT DEFAULT 'preview',
      request_meta TEXT,
      request_prompt TEXT,
      raw_response TEXT,
      parsed_candidate TEXT,
      status TEXT DEFAULT 'ok',
      error TEXT,
      attempts INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    );
  `);

  // Добавляем колонку updated_at если её нет (для существующих БД)
  try {
    // Проверяем, существует ли колонка
    const tableInfo = db.prepare("PRAGMA table_info(lessons)").all();
    const hasUpdatedAt = tableInfo.some(col => col.name === 'updated_at');
    if (!hasUpdatedAt) {
      db.prepare('ALTER TABLE lessons ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP').run();
      console.log('Added updated_at column to lessons table');
    }
  } catch (e) {
    // Игнорируем ошибки миграции
    console.warn('Migration warning:', e.message);
  }

  console.log('Database initialized');
}

function getDb() {
  if (!db) {
    initDb();
  }
  return db;
}

module.exports = { initDb, getDb };

