import { GoogleGenAI } from '@google/genai';

let aiInstance: GoogleGenAI | null = null;
let currentApiKey: string = '';
let workerEnvApiKey: string | undefined;

/**
 * Sets the Gemini API key from the Cloudflare Worker environment secret (env.GEMINI_API_KEY).
 * Never logs or exposes the key.
 */
export function setWorkerGeminiApiKey(apiKey?: string): void {
  const normalized = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (normalized !== workerEnvApiKey) {
    workerEnvApiKey = normalized || undefined;
    aiInstance = null;
  }
}

export function hasConfiguredGeminiApiKey(): boolean {
  const key =
    workerEnvApiKey ||
    (typeof process !== 'undefined' && process.env ? process.env.GEMINI_API_KEY : '') ||
    '';
  return Boolean(key && key.trim().length > 0);
}

export function getGeminiClient(): GoogleGenAI {
  const resolvedKey =
    workerEnvApiKey ||
    (typeof process !== 'undefined' && process.env ? process.env.GEMINI_API_KEY : '') ||
    '';

  if (!aiInstance || currentApiKey !== resolvedKey) {
    currentApiKey = resolvedKey;
    aiInstance = new GoogleGenAI({
      apiKey: resolvedKey,
      httpOptions: {
        timeout: 10000,
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiInstance;
}
