const KEY = 'shenglingyin:save:v1';

export interface SaveData {
  v: 1;
  world: string;
  seed: number;
  picked: number[];
  savedAt: number;
}

export function saveGame(data: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 隐私模式/容量满：静默降级，游玩不受影响
  }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return parseSave(raw);
  } catch {
    return null;
  }
}

export function clearGame(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // 同上：静默
  }
}

export function serializeSave(data: SaveData): string {
  return JSON.stringify(data, null, 2);
}

export function parseSave(text: string): SaveData {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error('存档不是合法 JSON 文本');
  }
  if (typeof obj !== 'object' || obj === null) throw new Error('存档格式不正确（应为对象）');
  const o = obj as Record<string, unknown>;
  if (o.v !== 1) throw new Error('存档版本不匹配（期望 v=1）');
  if (typeof o.world !== 'string' || o.world.length === 0) throw new Error('存档缺少 world 字段');
  if (typeof o.seed !== 'number' || !Number.isSafeInteger(o.seed) || o.seed < 0) {
    throw new Error('存档 seed 字段不合法（应为非负整数）');
  }
  if (!Array.isArray(o.picked) || o.picked.some((p) => typeof p !== 'number' || !Number.isSafeInteger(p) || p < 0)) {
    throw new Error('存档 picked 字段不合法（应为非负整数数组）');
  }
  const savedAt = typeof o.savedAt === 'number' ? o.savedAt : Date.now();
  return { v: 1, world: o.world, seed: o.seed, picked: [...o.picked], savedAt };
}

export function downloadSave(data: SaveData): void {
  const blob = new Blob([serializeSave(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `shenglingyin-save-${data.seed}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export { KEY as SAVE_KEY };
