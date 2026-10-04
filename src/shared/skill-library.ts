export const skillLibraryFloor = (id: string | null | undefined) => id === 'ai-innovators';
export interface LibrarySkill { id: string; name: string; description: string; category: string; version: string; dirty: boolean }
export interface SkillVersion { id: string; date: string; message: string }
export interface SkillDocument { skill: LibrarySkill; text: string; versions: SkillVersion[]; revision: string; diff?: string }
