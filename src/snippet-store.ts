import type { AppSettings } from './types';

/** Persistência local (localStorage) do agente de snippets ativo e do ranking de uso. */

export type ActiveSnippetAgent = 'agy' | 'claude';

const STORAGE_AGENT_KEY = 'cajuterm:activeSnippetAgent';
const STORAGE_USAGE_KEY = 'cajuterm:snippetUsage';

export function readStoredUsage(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_USAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        out[k] = Math.floor(v);
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function readInitialAgent(settings: AppSettings): ActiveSnippetAgent {
  if (settings.activeSnippetAgent === 'agy' || settings.activeSnippetAgent === 'claude') {
    return settings.activeSnippetAgent;
  }
  try {
    return localStorage.getItem(STORAGE_AGENT_KEY) === 'claude' ? 'claude' : 'agy';
  } catch {
    return 'agy';
  }
}

export function mergeUsageMaps(
  diskUsage: Record<string, number> | undefined,
  localUsage: Record<string, number>
): Record<string, number> {
  const merged: Record<string, number> = { ...localUsage };
  if (diskUsage) {
    for (const [k, v] of Object.entries(diskUsage)) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        merged[k] = Math.max(merged[k] ?? 0, Math.floor(v));
      }
    }
  }
  return merged;
}

export function writeSnippetStateToStorage(agent: ActiveSnippetAgent, usage: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_AGENT_KEY, agent);
    localStorage.setItem(STORAGE_USAGE_KEY, JSON.stringify(usage));
  } catch {
    // Ignora indisponibilidade de storage
  }
}
