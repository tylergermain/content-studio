export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string; at?: number }
export interface ChatArtifact { path: string; name: string; type: string; size: number; modified: number }
export interface ChatSnapshot {
  worker: { id: string; name: string; provider?: string; status: string; activity?: string; sessionId?: string };
  messages: ChatMessage[];
  artifacts: ChatArtifact[];
  source: 'session' | 'waiting';
  liveConfigured: boolean;
  liveAdmin: boolean;
}

/** Keep the voice bridge's routing instructions out of the visible conversation. */
export function displayChatText(text: string): string {
  if (!text.startsWith('Follow this live voice request in your current session.')) return text;
  const match = /Latest user request: ([\s\S]+?)\s+Respond with the result or progress so the voice assistant can report back\./.exec(text);
  return match?.[1].trim() || text;
}
