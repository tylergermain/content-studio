import type { AgentProvider } from './providers.js';

export const STUDIO_PROVIDERS: AgentProvider[] = ['claude', 'codex', 'pi'];
export const LOCAL_PI_PROVIDER = 'studio-local';
export const LOCAL_PI_MODEL = 'qwen3.8-flash-next';
export function isStudioProvider(value: unknown): value is AgentProvider {
  return STUDIO_PROVIDERS.includes(value as AgentProvider);
}
export function studioChoiceError(provider: unknown, model?: unknown): string | undefined {
  if (!isStudioProvider(provider)) return 'Choose Claude Code, Codex, or Pi (local)';
  if (provider === 'pi' && typeof model === 'string' && model.includes('/') && !model.startsWith(`${LOCAL_PI_PROVIDER}/`)) return 'Pi (local) only supports studio-local models';
}
export function localPiModel(model?: string): string {
  const error = studioChoiceError('pi', model);
  if (error) throw new Error(error);
  return model?.includes('/') ? model : `${LOCAL_PI_PROVIDER}/${model || LOCAL_PI_MODEL}`;
}
