// back/src/services/aiService.js
const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { getDb } = require('../sqlite');

// keep an internal stub for fallback
async function generateCourseStub(meta) {
  return {
    title: meta.title || 'Untitled course',
    description: meta.description || '',
    modules: [
      { title: "Введение", lessons: [ { title: "Что это за курс", content: "Короткое описание." } ] },
      { title: "Основы", lessons: [
          { title: "Урок 1", content: "Материал урока 1" },
          { title: "Урок 2", content: "Материал урока 2" }
        ]
      }
    ]
  };
}

// config
const MAX_RETRIES = 4;
const MAX_TOKENS = 3000;

// load schema
const schema = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'course.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

// helper: write file log (existing)
const LOG_DIR = path.resolve(process.cwd(), 'storage', 'ai_logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function writeFileLog(name, obj) {
  try {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(LOG_DIR, `${ts}--${name}.json`), JSON.stringify(obj, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to write ai file log', e);
  }
}

// DB audit: insert into ai_logs
function writeDbLog({ projectId = null, type = 'preview', request_meta = null, request_prompt = null, raw = null, parsed = null, status = 'ok', error = null, attempts = 0 }) {
  try {
    const db = getDb();
    const stmt = db.prepare(`INSERT INTO ai_logs
      (project_id, type, request_meta, request_prompt, raw_response, parsed_candidate, status, error, attempts)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    stmt.run(
      projectId,
      type,
      request_meta ? JSON.stringify(request_meta) : null,
      request_prompt ? request_prompt : null,
      raw ? (typeof raw === 'string' ? raw : JSON.stringify(raw)) : null,
      parsed ? JSON.stringify(parsed) : null,
      status,
      error ? (error.message || JSON.stringify(error)) : null,
      attempts
    );
  } catch (e) {
    console.error('Failed to write ai log to DB', e);
  }
}

// build prompt
function buildMetaPrompt(meta) {
  return `
You are SmartFlow: generate a course JSON strictly matching the provided schema (title, description, modules[]).

Meta: ${JSON.stringify(meta, null, 2)}

Requirements:
- Return only valid JSON object, nothing else (no explanation).
- Output must contain "title" (string) and "modules" (array).
- Each module must have "title" and "lessons" (array). Each lesson must have "title" and "content" (both strings).
- Where appropriate include "examples" (array of strings) and "quizzes" (array of objects with question,type,options,answer).
- Keep the language and level for the target audience: ${meta.audience || 'general'}, level: ${meta.level || 'beginner'}.
- If you cannot produce full content, return partial but valid JSON that passes the schema.
`;
}

// internal call (single attempt)
async function callLLMInternal(prompt, max_tokens = MAX_TOKENS) {
  // Динамически импортируем ESM адаптер
  const { callGeminiText } = await import('./geminiClient.mjs');
  
  // Вызываем Gemini API
  const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const text = await callGeminiText(prompt, {
    model,
    maxOutputTokens: max_tokens,
    temperature: 0.2
  });
  
  return text;
}

// jitter helper
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function randBetween(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

// robust call with retries + jitter
async function callLLM(prompt, max_tokens = MAX_TOKENS, retries = MAX_RETRIES) {
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const raw = await callLLMInternal(prompt, max_tokens);
      return { raw, attempts: attempt + 1 };
    } catch (err) {
      lastErr = err;
      const code = err.statusCode || '';
      const isRetryable = code === 429 || err.message.includes('ECONNREFUSED') || err.message.includes('ETIMEDOUT') || err.message.includes('ENOTFOUND');
      if (!isRetryable || attempt === retries - 1) break;
      // backoff with jitter
      const base = Math.pow(2, attempt) * 1000;
      const jitter = randBetween(0, 500);
      const delay = base + jitter;
      console.warn(`LLM call failed (attempt ${attempt+1}/${retries}), retrying in ${delay}ms:`, err.message);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// try parse JSON robustly
function tryParseJson(text) {
  if (typeof text !== 'string') throw new Error('text is not a string');
  // remove markdown fences
  let t = text.trim();
  // find first { and last } to attempt extraction
  const fb = t.indexOf('{');
  const lb = t.lastIndexOf('}');
  if (fb === -1 || lb === -1) throw new Error('No JSON braces found in LLM response');
  const candidate = t.slice(fb, lb + 1);
  return JSON.parse(candidate);
}

// sanitize parsed candidate: ensure strings, strip nulls, coerce arrays where needed
function sanitizeParsed(parsed) {
  if (!parsed || typeof parsed !== 'object') return parsed;
  // title/description
  if (parsed.title && typeof parsed.title !== 'string') parsed.title = String(parsed.title);
  if (parsed.description && typeof parsed.description !== 'string') parsed.description = String(parsed.description);

  if (Array.isArray(parsed.modules)) {
    parsed.modules = parsed.modules.map((m) => {
      if (m.title && typeof m.title !== 'string') m.title = String(m.title);
      if (!Array.isArray(m.lessons)) m.lessons = [];
      m.lessons = m.lessons.map((l) => {
        // coerce content and title to string
        if (l.title && typeof l.title !== 'string') l.title = String(l.title);
        if (l.content === null || l.content === undefined) l.content = '';
        if (typeof l.content !== 'string') {
          // if content is object/array, stringify nicely
          try { l.content = (typeof l.content === 'object') ? JSON.stringify(l.content) : String(l.content); }
          catch (e) { l.content = String(l.content); }
        }
        // examples: coerce to array of strings
        if (!Array.isArray(l.examples)) l.examples = [];
        else l.examples = l.examples.map(e => (e === null || e === undefined) ? '' : String(e));
        // quizzes shape: ensure array of objects
        if (!Array.isArray(l.quizzes)) l.quizzes = [];
        else {
          l.quizzes = l.quizzes.map(q => {
            if (!q || typeof q !== 'object') return { question: String(q), type: 'open', options: [], answer: null };
            q.question = q.question ? String(q.question) : '';
            q.type = q.type ? String(q.type) : 'open';
            if (!Array.isArray(q.options)) q.options = [];
            else q.options = q.options.map(o => String(o));
            return q;
          });
        }
        return l;
      });
      return m;
    });
  } else {
    parsed.modules = [];
  }
  return parsed;
}

// main generator: accepts meta and optional projectId (for audit)
async function generateCourse(meta = {}, options = { projectId: null, type: 'preview' }) {
  const projectId = options.projectId || null;
  const type = options.type || 'preview';
  const prompt = buildMetaPrompt(meta);
  writeFileLog('request_meta', { meta, prompt });
  writeDbLog({ projectId, type, request_meta: meta, request_prompt: prompt, attempts: 0 });

  try {
    const { raw, attempts } = await callLLM(prompt, MAX_TOKENS, MAX_RETRIES);
    writeFileLog('raw_response', raw);
    // update DB log later with raw/parsing/result
    let parsed;
    try {
      parsed = tryParseJson(raw);
    } catch (e) {
      // try direct parse of whole string (in case extracted braces logic fails)
      try { parsed = JSON.parse(raw); }
      catch (e2) {
        // parsing failed -> record and fallback
        writeFileLog('parse_failed_raw', { raw, error: e2.message });
        writeDbLog({ projectId, type, request_meta: meta, request_prompt: prompt, raw, parsed: null, status: 'llm_error', error: e2.message, attempts });
        throw new Error('Failed to parse JSON from LLM response: ' + e2.message);
      }
    }

    writeFileLog('parsed_candidate', parsed);

    // sanitize parsed object
    const sanitized = sanitizeParsed(parsed);
    writeFileLog('sanitized_candidate', sanitized);

    // validate
    const valid = validate(sanitized);
    if (!valid) {
      const errors = validate.errors;
      writeFileLog('validation_error', { errors, sanitized });
      writeDbLog({ projectId, type, request_meta: meta, request_prompt: prompt, raw, parsed: sanitized, status: 'validation_error', error: JSON.stringify(errors), attempts });
      const err = new Error('Validation failed');
      err.details = errors;
      err.raw = sanitized;
      throw err;
    }

    // success
    writeDbLog({ projectId, type, request_meta: meta, request_prompt: prompt, raw, parsed: sanitized, status: 'ok', attempts });
    writeFileLog('validation_success', sanitized);
    return sanitized;
  } catch (err) {
    console.error('generateCourse error:', err.message || err);
    // fallback: use stub and mark fallback_used
    try {
      const fallback = await generateCourseStub(meta);
      writeFileLog('fallback_used', { fallback });
      writeDbLog({ projectId, type, request_meta: meta, request_prompt: prompt, raw: null, parsed: fallback, status: 'fallback_used', error: err.message, attempts: MAX_RETRIES });
      return fallback;
    } catch (fallbackErr) {
      writeDbLog({ projectId, type, request_meta: meta, request_prompt: prompt, raw: null, parsed: null, status: 'llm_error', error: err.message, attempts: MAX_RETRIES });
      throw err;
    }
  }
}

module.exports = { generateCourse, generateCourseStub };
