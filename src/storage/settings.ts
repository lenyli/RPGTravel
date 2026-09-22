import { getSetting, setSetting } from './db';

export type AiSettings = {
  enabled: boolean;
  provider: 'deepseek';
  apiKey?: string;
  model: 'deepseek-flash';
};

const KEY = 'ai';

export function maskApiKey(apiKey: string): string {
  const tail = apiKey.length >= 4 ? apiKey.slice(-4) : '';
  return tail ? `••••${tail}` : '••••';
}

export async function loadAiSettings(): Promise<AiSettings> {
  const stored = await getSetting<Partial<AiSettings>>(KEY);
  const apiKey =
    typeof stored?.apiKey === 'string' && stored.apiKey.trim()
      ? stored.apiKey
      : undefined;
  return {
    enabled: stored?.enabled === true,
    provider: 'deepseek',
    apiKey,
    model: 'deepseek-flash',
  };
}

export async function saveAiSettings(settings: {
  enabled: boolean;
  apiKey?: string;
}): Promise<void> {
  const stored: AiSettings = {
    enabled: settings.enabled,
    provider: 'deepseek',
    model: 'deepseek-flash',
  };
  if (settings.apiKey) stored.apiKey = settings.apiKey;
  await setSetting(KEY, stored);
}
