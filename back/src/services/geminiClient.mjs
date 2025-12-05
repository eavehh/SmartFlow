// back/src/services/geminiClient.mjs
import fetch from 'node-fetch';

// Загружаем dotenv для ESM (используем динамический импорт)
let dotenvLoaded = false;
async function ensureDotenv() {
  if (!dotenvLoaded) {
    try {
      // В ESM dotenv экспортируется как default
      const dotenvModule = await import('dotenv');
      const dotenv = dotenvModule.default || dotenvModule;
      const { fileURLToPath } = await import('url');
      const { dirname, resolve } = await import('path');
      const __filename = fileURLToPath(import.meta.url);
      const __dirname = dirname(__filename);
      const envPath = resolve(__dirname, '../../.env');
      const result = dotenv.config({ path: envPath });
      if (result.error) {
        console.warn('Dotenv config error:', result.error);
      }
      dotenvLoaded = true;
      console.log('Dotenv loaded in ESM module, GEMINI_API_KEY:', process.env.GEMINI_API_KEY ? 'SET (' + process.env.GEMINI_API_KEY.substring(0, 10) + '...)' : 'NOT SET');
    } catch (err) {
      console.error('Failed to load dotenv in ESM:', err);
      // Продолжаем работу, возможно dotenv уже загружен в CommonJS
      dotenvLoaded = true; // Помечаем как загруженный, чтобы не повторять попытки
    }
  }
}

// Получаем API ключ из окружения (проверка будет при вызове функции)
function getApiKey() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY is not set. Available env vars:', Object.keys(process.env).filter(k => k.includes('GEMINI')));
    throw new Error('GEMINI_API_KEY is not set in environment variables. Please check your .env file.');
  }
  return apiKey;
}

/**
 * Получить список доступных моделей
 */
async function getAvailableModels() {
  try {
    await ensureDotenv();
    const apiKey = getApiKey();
    // Пробуем разные варианты endpoint для получения списка моделей
    const endpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
      `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
    ];
    
    for (const url of endpoints) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          const models = data?.models || [];
          console.log(`Found ${models.length} total models from ${url}`);
          
          // Фильтруем модели, которые поддерживают generateContent
          const available = models
            .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
            .map(m => m.name);
          
          console.log(`Found ${available.length} models supporting generateContent`);
          if (available.length > 0) {
            console.log('Available models:', available.slice(0, 10).join(', '));
            return available;
          }
        } else {
          const errorText = await res.text();
          console.error(`Failed to fetch models from ${url}: ${res.status}`);
          console.error('Error details:', errorText);
          
          // Проверяем тип ошибки
          if (res.status === 401 || res.status === 403) {
            throw new Error(`API key authentication failed (${res.status}): ${errorText}. Please check if your GEMINI_API_KEY is valid and not expired.`);
          }
          // Если ошибка региона - пробрасываем сразу
          if (res.status === 400 && errorText.includes('location is not supported')) {
            throw new Error(`Gemini API is not available in your region. Error: ${errorText}. Possible solutions: Use VPN, proxy, or contact Google Cloud support. Check: https://ai.google.dev/available_regions`);
          }
          if (res.status === 400) {
            console.warn(`Bad request (${res.status}): ${errorText}`);
          }
        }
      } catch (e) {
        if (e.message.includes('authentication failed') || e.message.includes('location is not supported') || e.message.includes('not available in your region')) {
          throw e; // Пробрасываем ошибки аутентификации и региона
        }
        console.warn(`Error fetching models from ${url}:`, e.message);
        continue;
      }
    }
    
    console.warn('No available models found via ListModels API');
    return [];
  } catch (error) {
    if (error.message.includes('authentication failed') || error.message.includes('location is not supported') || error.message.includes('not available in your region')) {
      throw error; // Пробрасываем ошибки аутентификации и региона
    }
    console.warn('Error fetching models list:', error.message);
    return [];
  }
}

/**
 * callGeminiText - использует REST API напрямую
 * @param {string|string[]} contents - строка prompt или массив частей
 * @param {object} opts - { model, temperature, maxOutputTokens }
 * @returns {Promise<string>} - текст ответа (plain)
 */
export async function callGeminiText(contents, opts = {}) {
  // Убеждаемся, что dotenv загружен
  await ensureDotenv();
  
  // Используем модель из опций или из env
  let modelName = opts.model || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  
  // Если модель указана без префикса models/, добавляем его
  if (!modelName.startsWith('models/')) {
    modelName = `models/${modelName}`;
  }
  
  const temperature = typeof opts.temperature === 'number' ? opts.temperature : 0.2;
  const maxOutputTokens = opts.maxOutputTokens || 1500;

  // Получаем список доступных моделей
  console.log('Fetching available models...');
  const availableModels = await getAvailableModels();
  
  if (availableModels.length > 0) {
    console.log('Available models:', availableModels.slice(0, 5).join(', '), '...');
  }

  // Список моделей для попытки (в порядке приоритета)
  // Пробуем разные варианты имен моделей
  const baseModelName = modelName.replace(/^models\//, ''); // Убираем префикс если есть
  let modelsToTry = [
    modelName,  // Сначала пробуем указанную модель
    baseModelName, // Пробуем без префикса models/
    `models/${baseModelName}`, // Пробуем с префиксом
    'gemini-1.5-flash', // Простые имена
    'gemini-1.5-pro',
    'gemini-pro',
    'models/gemini-1.5-flash',
    'models/gemini-1.5-pro',
    'models/gemini-pro',
    'gemini-1.5-flash-001',
    'gemini-1.5-pro-001',
    'models/gemini-1.5-flash-001',
    'models/gemini-1.5-pro-001'
  ];
  
  // Убираем дубликаты
  modelsToTry = [...new Set(modelsToTry)];

  // Если получили список моделей, добавляем их в начало
  if (availableModels.length > 0) {
    modelsToTry = [...availableModels, ...modelsToTry.filter(m => !availableModels.includes(m))];
  }

  let lastError = null;

  for (const tryModel of modelsToTry) {
    // Пропускаем дубликаты
    if (tryModel === modelName && modelsToTry.indexOf(tryModel) !== 0) continue;

    try {
      // Преобразуем contents в строку
      const prompt = Array.isArray(contents) ? contents.join('\n') : String(contents);

      // Пробуем разные версии API
      const apiVersions = ['v1beta', 'v1'];
      let lastApiError = null;
      
      for (const version of apiVersions) {
        try {
          const apiKey = getApiKey();
          // Пробуем оба варианта: с префиксом models/ и без
          // Сначала пробуем с префиксом models/
          const modelVariants = tryModel.startsWith('models/') 
            ? [tryModel, tryModel.replace('models/', '')]
            : [`models/${tryModel}`, tryModel];
          
          let lastVariantError = null;
          for (const modelNameInUrl of modelVariants) {
            try {
              const url = `https://generativelanguage.googleapis.com/${version}/${modelNameInUrl}:generateContent?key=${apiKey}`;
              
              console.log(`Trying model: ${modelNameInUrl} with API ${version}`);
    
          const body = {
            contents: [{
              parts: [{
                text: prompt
              }]
            }],
            generationConfig: {
              temperature,
              maxOutputTokens
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
                // Если 401 или 403 - проблема с ключом, не пробуем дальше
                if (res.status === 401 || res.status === 403) {
                  const errorMsg = `API key authentication failed (${res.status}): ${txt}. Please check if your GEMINI_API_KEY is valid and not expired. Get a new key from: https://makersuite.google.com/app/apikey`;
                  console.error(errorMsg);
                  throw new Error(errorMsg);
                }
                // Если 404, пробуем следующий вариант имени модели
                if (res.status === 404) {
                  lastVariantError = new Error(`Model ${modelNameInUrl} not found in ${version}: ${txt}`);
                  continue; // Пробуем следующий вариант имени модели
                }
                // Если 400 с ошибкой локации - это критическая ошибка региона, не пробуем дальше
                if (res.status === 400 && txt.includes('location is not supported')) {
                  const errorMsg = `Gemini API is not available in your region. Error: ${txt}. Possible solutions: Use VPN, proxy, or contact Google Cloud support. Check: https://ai.google.dev/available_regions`;
                  console.error(errorMsg);
                  throw new Error(errorMsg);
                }
                // Если 429 (quota exceeded), пробуем следующую модель
                if (res.status === 429) {
                  console.log(`Model ${modelNameInUrl} quota exceeded, trying next model...`);
                  lastVariantError = new Error(`Model ${modelNameInUrl} quota exceeded: ${txt}`);
                  break; // Выходим из цикла вариантов, пробуем следующую модель
                }
                throw new Error(`Gemini REST API error ${res.status}: ${txt}`);
              }

              const data = await res.json();
              
              // Проверяем finishReason
              const finishReason = data?.candidates?.[0]?.finishReason;
              const candidate = data?.candidates?.[0]?.content?.parts?.[0]?.text;
              
              // Если MAX_TOKENS и нет текста, пробуем повторить с увеличенным лимитом
              if (finishReason === 'MAX_TOKENS' && !candidate) {
                console.log(`Model ${modelNameInUrl} hit MAX_TOKENS without text. Retrying with increased limit...`);
                // Увеличиваем лимит в 2 раза, но не больше 8000
                const newMaxTokens = Math.min(maxOutputTokens * 2, 8000);
                
                const retryBody = {
                  contents: [{
                    parts: [{
                      text: prompt
                    }]
                  }],
                  generationConfig: {
                    temperature,
                    maxOutputTokens: newMaxTokens
                  }
                };

                const retryRes = await fetch(url, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(retryBody)
                });

                if (retryRes.ok) {
                  const retryData = await retryRes.json();
                  const retryCandidate = retryData?.candidates?.[0]?.content?.parts?.[0]?.text;
                  if (retryCandidate) {
                    console.log(`Successfully used model: ${modelNameInUrl} with API ${version} (retry with ${newMaxTokens} tokens)`);
                    return retryCandidate;
                  }
                }
                // Если retry не помог, пробуем следующую модель
                console.log(`Retry with increased limit didn't help, trying next model...`);
                lastVariantError = new Error(`Model ${modelNameInUrl} hit MAX_TOKENS even with ${newMaxTokens} tokens`);
                break; // Выходим из цикла вариантов, пробуем следующую модель
              }
              
              // Если все еще нет текста, пробуем следующую модель
              if (!candidate) {
                console.error('Unexpected Gemini response:', JSON.stringify(data, null, 2));
                // Если это MAX_TOKENS, пробуем следующую модель
                if (finishReason === 'MAX_TOKENS') {
                  console.log(`Model ${modelNameInUrl} hit MAX_TOKENS, trying next model...`);
                  lastVariantError = new Error(`Model ${modelNameInUrl} hit MAX_TOKENS without text`);
                  break; // Выходим из цикла вариантов, пробуем следующую модель
                }
                throw new Error('No text content in Gemini response');
              }
              
              console.log(`Successfully used model: ${modelNameInUrl} with API ${version}`);
              return candidate;
            } catch (variantError) {
              // Если это не 404, не ошибка локации и не квота, прерываем цикл вариантов
              if (!variantError.message.includes('404') && 
                  !variantError.message.includes('not found') &&
                  !variantError.message.includes('location is not supported') &&
                  !variantError.message.includes('429') &&
                  !variantError.message.includes('quota')) {
                throw variantError;
              }
              lastVariantError = variantError;
            }
          }
          
          // Если оба варианта имени модели не сработали, пробуем следующую версию API
          if (lastVariantError) {
            lastApiError = lastVariantError;
            continue; // Пробуем следующую версию API
          }
        } catch (apiError) {
          // Если это не 404, не ошибка локации и не квота, прерываем цикл версий API
          if (!apiError.message.includes('404') && 
              !apiError.message.includes('not found') &&
              !apiError.message.includes('location is not supported') &&
              !apiError.message.includes('429') &&
              !apiError.message.includes('quota')) {
            throw apiError;
          }
          lastApiError = apiError;
        }
      }
      
      // Если обе версии API не сработали для этой модели, пробуем следующую модель
      if (lastApiError) {
        console.log(`Model ${tryModel} not found in any API version, trying next model...`);
        lastError = lastApiError;
        continue;
      }
    } catch (error) {
      // Если это не 404, не ошибка локации и не квота, прерываем цикл
      if (!error.message.includes('404') && 
          !error.message.includes('not found') &&
          !error.message.includes('location is not supported') &&
          !error.message.includes('429') &&
          !error.message.includes('quota')) {
        console.error('Gemini API error:', error);
        throw new Error(`Gemini API error: ${error.message}`);
      }
      lastError = error;
    }
  }

  // Если все модели не сработали
  console.error('All models failed. Last error:', lastError);
  throw new Error(`Gemini API error: All models failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Генерация изображения через Gemini Imagen API
 * @param {string} prompt - описание изображения
 * @param {object} opts - опции генерации
 * @returns {Promise<string>} - URL изображения или base64
 */
export async function generateImage(prompt, opts = {}) {
  await ensureDotenv();
  const apiKey = getApiKey();
  
  // Пробуем разные варианты Imagen API
  const apiVersions = ['v1beta', 'v1'];
  const models = [
    'imagen-3.0-generate-001',
    'imagen-3',
    'imagen-2',
    'imagegeneration@006' // Старый формат
  ];
  
  for (const version of apiVersions) {
    for (const model of models) {
      try {
        // Пробуем оба варианта: с префиксом и без
        const modelVariants = [
          `models/${model}`,
          model
        ];
        
        for (const modelName of modelVariants) {
          try {
            const url = `https://generativelanguage.googleapis.com/${version}/${modelName}:generateImages?key=${apiKey}`;
            
            console.log(`Trying to generate image with ${modelName} (${version})`);
            
            const body = {
              prompt: prompt,
              number_of_images: opts.numberOfImages || 1,
              aspect_ratio: opts.aspectRatio || '1:1',
              safety_filter_level: opts.safetyFilterLevel || 'block_some',
              person_generation: opts.personGeneration || 'allow_all'
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
              console.log(`Imagen API error ${res.status} for ${modelName}:`, txt.substring(0, 200));
              
              if (res.status === 404 || (res.status === 400 && !txt.includes('location is not supported'))) {
                console.log(`Model ${modelName} not available (${res.status}), trying next...`);
                continue;
              }
              if (res.status === 401 || res.status === 403) {
                throw new Error(`API key authentication failed: ${txt}`);
              }
              if (res.status === 400 && txt.includes('location is not supported')) {
                throw new Error(`Image generation is not available in your region: ${txt}`);
              }
              // Для других ошибок пробуем следующую модель
              console.log(`Error ${res.status} for ${modelName}, trying next model...`);
              continue;
            }
            
            const data = await res.json();
            console.log('Imagen API response structure:', JSON.stringify(data, null, 2).substring(0, 500));
            
            // Пробуем разные варианты структуры ответа
            const images = data?.generatedImages || data?.images || data?.image || [];
            
            if (images.length === 0) {
              // Если нет массива, возможно изображение напрямую в ответе
              if (data?.imageUrl || data?.url || data?.base64) {
                const directUrl = data.imageUrl || data.url || data.base64;
                console.log(`Successfully generated image with ${modelName} (direct URL)`);
                return directUrl;
              }
              throw new Error('No images generated in response');
            }
            
            // Возвращаем URL первого изображения или base64
            const image = images[0];
            const imageUrl = image?.imageUrl || image?.url || image?.base64 || image?.imageBase64 || image?.bytes;
            
            if (!imageUrl) {
              console.error('Image response structure:', JSON.stringify(image, null, 2));
              throw new Error('No image URL in response');
            }
            
            // Если это base64, форматируем для markdown
            let finalUrl = imageUrl;
            if (typeof imageUrl === 'string' && imageUrl.startsWith('data:image')) {
              // Уже в формате data URI
              finalUrl = imageUrl;
            } else if (typeof imageUrl === 'string' && !imageUrl.startsWith('http')) {
              // Возможно base64 без префикса, добавляем его
              finalUrl = `data:image/png;base64,${imageUrl}`;
            }
            
            console.log(`Successfully generated image with ${modelName}`);
            return finalUrl;
          } catch (variantError) {
            if (variantError.message.includes('authentication') || 
                variantError.message.includes('location is not supported')) {
              throw variantError;
            }
            continue;
          }
        }
      } catch (modelError) {
        if (modelError.message.includes('authentication') || 
            modelError.message.includes('location is not supported')) {
          throw modelError;
        }
        continue;
      }
    }
  }
  
  throw new Error('Image generation failed: No available Imagen models or API not available in your region');
}

