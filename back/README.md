# SmartFlow Backend

Backend сервис для генерации образовательных курсов с использованием LLM API (Gemini, OpenAI и др.).

## Быстрый старт

### 1. Установка зависимостей

```bash
npm install
```

### 2. Настройка базы данных

```bash
npm run migrate
```

### 3. Настройка LLM провайдера

#### Вариант A: Gemini (рекомендуется)

1. Получите API ключ на https://makersuite.google.com/app/apikey
2. Создайте `.env` файл:
   ```bash
   cp .env.example .env
   ```
3. Укажите в `.env`:
   ```env
   LLM_PROVIDER=gemini
   GEMINI_API_KEY=your-gemini-api-key-here
   GEMINI_MODEL=gemini-pro
   ```

#### Вариант B: OpenAI

1. Получите API ключ на https://platform.openai.com
2. Создайте `.env` файл:
   ```bash
   cp .env.example .env
   ```
3. Укажите в `.env`:
   ```env
   LLM_PROVIDER=openai
   OPENAI_KEY=sk-your-key-here
   OPENAI_MODEL=gpt-4o-mini
   ```

### 4. Запуск сервера

```bash
npm run dev
```

Сервер запустится на `http://localhost:3000`

## API Endpoints

### Проекты

- `POST /api/projects` — создать проект
- `GET /api/projects` — список проектов
- `GET /api/projects/:id` — получить проект с модулями и уроками
- `POST /api/projects/:id/generate-preview` — предпросмотр генерации (не сохраняет в БД)
- `POST /api/projects/:id/generate-real` — реальная генерация (сохраняет в БД)

### Логи AI

- `GET /api/ai-logs?projectId=1&limit=20` — просмотр логов генерации

## Примеры использования

### Создание проекта

```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Курс по JavaScript",
    "description": "Изучение основ JS",
    "meta": {
      "audience": "students",
      "level": "beginner",
      "goal": "обучить основам программирования"
    }
  }'
```

### Предпросмотр генерации

```bash
curl -X POST http://localhost:3000/api/projects/1/generate-preview
```

### Реальная генерация (сохраняет в БД)

```bash
curl -X POST http://localhost:3000/api/projects/1/generate-real
```

### Просмотр логов

```bash
curl "http://localhost:3000/api/ai-logs?projectId=1&limit=10"
```

## Структура проекта

```
back/
├── src/
│   ├── server.js           # Express сервер
│   ├── sqlite.js           # SQLite helper
│   ├── routes/
│   │   ├── projects.js     # Роуты проектов
│   │   └── aiLogs.js       # Роуты логов
│   └── services/
│       ├── aiService.js    # LLM сервис (использует провайдеры)
│       ├── providers/      # LLM провайдеры (Gemini, OpenAI)
│       └── course.schema.json  # JSON schema для валидации
├── db/
│   └── migrations/         # SQL миграции
├── storage/
│   └── ai_logs/            # Файловые логи LLM
├── scripts/
│   └── migrate.sh          # Скрипт миграций
└── package.json
```

## Переменные окружения

См. `.env.example` для полного списка. Основные:

- `LLM_PROVIDER` — `gemini` или `openai` (по умолчанию `gemini`)
- `GEMINI_API_KEY` — API ключ Gemini (обязательно для Gemini)
- `GEMINI_MODEL` — модель Gemini (по умолчанию `gemini-pro`)
- `OPENAI_KEY` — API ключ OpenAI (обязательно для OpenAI)
- `OPENAI_MODEL` — модель OpenAI (по умолчанию `gpt-4o-mini`)
- `PORT` — порт сервера (по умолчанию `3000`)

## Скрипты

- `npm run dev` — запуск в режиме разработки с nodemon
- `npm start` — запуск production сервера
- `npm run migrate` — применить миграции БД

## База данных

Используется SQLite (`db.sqlite`). Таблицы:

- `users` — пользователи
- `projects` — проекты курсов
- `modules` — модули курса
- `lessons` — уроки
- `tests` — тесты
- `assets` — ресурсы
- `exports` — экспорты
- `ai_logs` — логи AI генераций

Просмотр БД:

```bash
sqlite3 db.sqlite
```

## Логирование

Все вызовы LLM логируются:

1. **В БД** (`ai_logs` таблица) — для аудита и анализа
2. **В файлы** (`storage/ai_logs/`) — для детальной отладки

Файлы логов содержат:
- `request_meta` — метаданные запроса
- `raw_response` — сырой ответ от LLM
- `parsed_candidate` — распарсенный JSON
- `sanitized_candidate` — очищенный JSON
- `validation_success` / `validation_error` — результаты валидации

## Troubleshooting

### Ошибки API провайдера

1. **Gemini**: Убедитесь, что `GEMINI_API_KEY` установлен и валиден
2. **OpenAI**: Убедитесь, что `OPENAI_KEY` установлен и валиден
3. Проверьте, что выбран правильный `LLM_PROVIDER` в `.env`

### Ошибки валидации

Проверьте логи в `storage/ai_logs/` — там будет видно, что именно вернул LLM и почему валидация не прошла.

### Медленная генерация

- Уменьшите `MAX_TOKENS` в `aiService.js`
- Используйте более быструю модель (например, `gpt-4o-mini` для OpenAI)

## Лицензия

ISC

