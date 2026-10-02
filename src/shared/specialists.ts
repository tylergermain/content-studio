export interface SpecialistProfile { id: string; name: string; instructions: string; tools: string[] }
export const specialistId = (id: unknown): id is string => typeof id === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(id);
