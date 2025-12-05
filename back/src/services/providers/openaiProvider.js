const fetch = require('node-fetch');
const LLMProvider = require('./llmProvider');

class OpenAIProvider extends LLMProvider {
  constructor(config = {}) {
    super(config);
    this.apiKey = config.apiKey || process.env.OPENAI_KEY;
    this.model = config.model || process.env.OPENAI_MODEL || 'gpt-4o-mini';
    
    if (!this.apiKey) {
      throw new Error('OPENAI_KEY is required for OpenAI provider');
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

    const body = {
      model: this.model,
      messages: [
        { role: 'system', content: systemMessage },
        { role: 'user', content: userMessage }
      ],
      temperature,
      max_tokens: maxTokens
    };

    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const txt = await res.text();
      const err = new Error(`OpenAI API error: ${res.status} ${txt}`);
      err.statusCode = res.status;
      throw err;
    }

    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('No content from OpenAI API');
    }

    return content;
  }
}

module.exports = OpenAIProvider;

