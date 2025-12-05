// Base LLM Provider interface
class LLMProvider {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Generate a response from the LLM
   * @param {string} prompt - The user prompt
   * @param {Object} options - Options like maxTokens, temperature, etc.
   * @returns {Promise<string>} The generated text
   */
  async generate(prompt, options = {}) {
    throw new Error('generate() must be implemented by provider');
  }

  /**
   * Generate a response with system and user messages
   * @param {string} systemMessage - System message
   * @param {string} userMessage - User message
   * @param {Object} options - Options like maxTokens, temperature, etc.
   * @returns {Promise<string>} The generated text
   */
  async generateWithMessages(systemMessage, userMessage, options = {}) {
    throw new Error('generateWithMessages() must be implemented by provider');
  }
}

module.exports = LLMProvider;

