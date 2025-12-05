const GeminiProvider = require('./geminiProvider');
const OpenAIProvider = require('./openaiProvider');

/**
 * Create an LLM provider based on configuration
 * @param {string} providerName - Name of the provider ('gemini', 'openai', etc.)
 * @param {Object} config - Provider-specific configuration
 * @returns {LLMProvider} Instance of the provider
 */
function createProvider(providerName, config = {}) {
  const provider = (process.env.LLM_PROVIDER || providerName || 'gemini').toLowerCase();

  switch (provider) {
    case 'gemini':
      return new GeminiProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${provider}. Supported: gemini, openai`);
  }
}

module.exports = {
  createProvider,
  GeminiProvider,
  OpenAIProvider
};

