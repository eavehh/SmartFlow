require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { initDb } = require('./sqlite');
const projectsRouter = require('./routes/projects');
const aiLogsRouter = require('./routes/aiLogs');
const chatRouter = require('./routes/chat');
const lessonsRouter = require('./routes/lessons');

const app = express();
app.use(cors());
app.use(bodyParser.json());

initDb();

app.use('/api/projects', projectsRouter);
app.use('/api/ai-logs', aiLogsRouter);
app.use('/api/chat', chatRouter);
app.use('/api/lessons', lessonsRouter);

// Тестовый роут для проверки Gemini API ключа
app.get('/test-gemini-key', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ ok: false, error: 'GEMINI_API_KEY is not set' });
    }
    
    // Проверяем ключ через ListModels API
    const testUrl = `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`;
    const fetch = (await import('node-fetch')).default;
    const testRes = await fetch(testUrl);
    
    if (testRes.status === 401 || testRes.status === 403) {
      const errorText = await testRes.text();
      return res.status(401).json({ 
        ok: false, 
        error: 'API key is invalid or expired',
        details: errorText,
        hint: 'Please check your GEMINI_API_KEY in .env file. Get a new key from: https://makersuite.google.com/app/apikey'
      });
    }
    
    if (!testRes.ok) {
      const errorText = await testRes.text();
      let errorJson;
      try {
        errorJson = JSON.parse(errorText);
      } catch (e) {
        errorJson = null;
      }
      
      // Проверяем на ошибку региона
      if (testRes.status === 400 && errorText.includes('location is not supported')) {
        return res.status(400).json({ 
          ok: false, 
          error: 'Gemini API is not available in your region',
          details: errorText,
          hint: 'Gemini API is currently not available in your location. Possible solutions:\n1. Use a VPN to connect from a supported region (US, EU, etc.)\n2. Use a proxy server\n3. Contact Google Cloud support for regional access\n\nSupported regions: United States, European Union, and some other countries. Check: https://ai.google.dev/available_regions'
        });
      }
      
      return res.status(testRes.status).json({ 
        ok: false, 
        error: `API key check failed: ${testRes.status}`,
        details: errorText
      });
    }
    
    const data = await testRes.json();
    const models = data?.models || [];
    const availableModels = models
      .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
      .map(m => m.name);
    
    res.json({ 
      ok: true, 
      message: 'API key is valid',
      totalModels: models.length,
      availableModels: availableModels.length,
      sampleModels: availableModels.slice(0, 5)
    });
  } catch (e) {
    console.error('Test Gemini key error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Тестовый роут для проверки Gemini API
app.get('/test-gemini', async (req, res) => {
  try {
    // Вызываем aiService wrapper, или напрямую импортируем адаптер
    const { callGeminiText } = await import('./services/geminiClient.mjs');
    const out = await callGeminiText('Explain in 2 short sentences what SmartFlow does.', {
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
      maxOutputTokens: 200
    });
    res.json({ ok: true, text: out });
  } catch (e) {
    console.error('Test Gemini error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Backend running on ${PORT}`));

