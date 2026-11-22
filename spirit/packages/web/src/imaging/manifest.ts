/**
 * 素材库 manifest 索引——读取 manifest.json，建立参数组合 → 文件路径查找表
 *
 * manifest schema（06 文档 §5）：
 *   scenes:   [{ id, place, era, file }]
 *   actors:   [{ id, race, form?, variety?, age_band, outfit, pose, file }]
 *   companions: [{ id, type, pose, file }]
 *   effects:  [{ id, milestone, file }]
 *
 * 合成器只依赖 manifest.json + 文件路径，不硬编码任何素材 ID。
 */

export interface SceneAsset {
  id: string;
  place: string;
  era: string;
  file: string;
}

export interface ActorAsset {
  id: string;
  race: string;
  form?: string;
  variety?: string;
  age_band: string;
  outfit: string;
  pose: string;
  file: string;
}

export interface CompanionAsset {
  id: string;
  type: string;
  pose: string;
  file: string;
}

export interface EffectAsset {
  id: string;
  milestone: string;
  file: string;
}

export interface Manifest {
  version: number;
  style_lock: string;
  scenes: SceneAsset[];
  actors: ActorAsset[];
  companions: CompanionAsset[];
  effects: EffectAsset[];
}

/** 合成器输入参数 */
export interface ComposeParams {
  place: string;
  era: string;
  race: string;
  form?: string;
  variety?: string;
  age_band: string;
  outfit: string;
  pose: string;
  /** 里程碑事件 id（可选，叠加特效图层） */
  milestone?: string;
}

export const ASSET_BASE = './images/';

let cachedManifest: Manifest | null = null;

/** 读取 manifest.json（带缓存） */
export async function loadManifest(): Promise<Manifest> {
  if (cachedManifest) return cachedManifest;
  const resp = await fetch(`${ASSET_BASE}manifest.json`);
  if (!resp.ok) throw new Error(`manifest.json 加载失败: ${resp.status}`);
  cachedManifest = (await resp.json()) as Manifest;
  return cachedManifest;
}

/** 同步获取已缓存的 manifest（未加载时返回 null） */
export function getManifest(): Manifest | null {
  return cachedManifest;
}

/** 查找场景底图 */
export function findScene(manifest: Manifest, place: string, era: string): SceneAsset | undefined {
  return manifest.scenes.find((s) => s.place === place && s.era === era);
}

/**
 * 查找主角图层——带缺省回退链
 * 精确匹配 → 逐级回退：variety → age_band → outfit → pose → 同 form 默认(youth/plain_robe/standing)
 */
export function findActor(manifest: Manifest, params: ComposeParams): ActorAsset | undefined {
  const { race, form, variety, age_band, outfit, pose } = params;

  // 1. 精确匹配
  let actor = manifest.actors.find(
    (a) =>
      a.race === race &&
      a.form === form &&
      a.variety === variety &&
      a.age_band === age_band &&
      a.outfit === outfit &&
      a.pose === pose,
  );
  if (actor) return actor;

  // 2. 回退 variety（去掉品种）
  actor = manifest.actors.find(
    (a) =>
      a.race === race &&
      a.form === form &&
      a.variety === undefined &&
      a.age_band === age_band &&
      a.outfit === outfit &&
      a.pose === pose,
  );
  if (actor) return actor;

  // 3. 回退 age_band → youth
  actor = manifest.actors.find(
    (a) =>
      a.race === race &&
      a.form === form &&
      a.variety === variety &&
      a.age_band === 'youth' &&
      a.outfit === outfit &&
      a.pose === pose,
  );
  if (actor) return actor;

  // 4. 回退 outfit → plain_robe
  actor = manifest.actors.find(
    (a) =>
      a.race === race &&
      a.form === form &&
      a.variety === variety &&
      a.age_band === age_band &&
      a.outfit === 'plain_robe' &&
      a.pose === pose,
  );
  if (actor) return actor;

  // 5. 回退 pose → standing
  actor = manifest.actors.find(
    (a) =>
      a.race === race &&
      a.form === form &&
      a.variety === variety &&
      a.age_band === age_band &&
      a.outfit === outfit &&
      a.pose === 'standing',
  );
  if (actor) return actor;

  // 6. 全回退：同 form 默认（youth/plain_robe/standing）
  actor = manifest.actors.find(
    (a) =>
      a.race === race &&
      a.form === form &&
      a.variety === variety &&
      a.age_band === 'youth' &&
      a.outfit === 'plain_robe' &&
      a.pose === 'standing',
  );
  if (actor) return actor;

  // 7. 最终回退：同 race 任意 actor
  actor = manifest.actors.find((a) => a.race === race);
  return actor;
}

/** 查找里程碑特效图层 */
export function findEffect(manifest: Manifest, milestone: string): EffectAsset | undefined {
  return manifest.effects.find((e) => e.milestone === milestone);
}

/** 加载图片为 HTMLImageElement（支持透明背景） */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    img.src = src;
  });
}
