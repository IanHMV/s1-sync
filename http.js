import { config } from './config.js';
import { logger } from './logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch nativo (Node 20+) con timeout por AbortController y reintentos.
// Reintenta ante errores de red y respuestas 5xx; NO reintenta 4xx (excepto 401,
// que se maneja arriba re-autenticando).
export async function fetchWithRetry(url, options = {}, { retries = config.maxRetries } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.httpTimeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timer);

      if (res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} en ${url}`);
        throw lastErr;
      }
      return res;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        const delay = 1000 * 2 ** attempt; // 1s, 2s, 4s...
        logger.warn('Reintentando peticion HTTP', { url, attempt: attempt + 1, delay, error: err.message });
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}
