const fetch = require('node-fetch');
const LLMProvider = require('./llmProvider');

class GeminiProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.GEMINI_API_KEY;
    this.model = config.model || process.env.GEMINI_MODEL || 'gemini-pro';
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
    
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY is required for Gemini provider');
    }
  }

  async generate(prompt, options = {}) {
    return this.generateWithMessages(
      'You are a JSON output-oriented course generator.',
      prompt,
      options
    );
  }

  async generateWithMessages(systemMessage, userMessage, options = {}) {
    const maxTokens = options.maxTokens || 3000;
    const temperature = options.temperature || 0.2;

    // Gemini API uses a different format
    // Combine system and user messages into a single prompt
    const fullPrompt = `${systemMessage}\n\n${userMessage}`;

    const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
    
    const body = {
      contents: [{
        parts: [{
          text: fullPrompt
        }]
      }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`Gemini API error: ${res.status} ${txt}`);
      err.statusCode = res.status;
      throw err;
    }

    const json = await res.json();
    
    // Extract text from Gemini response
    const content = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) {
      throw new Error('No content from Gemini API');
    }

    return content;
  }
}

module.exports = GeminiProvider;

