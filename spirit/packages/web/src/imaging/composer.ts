/**
 * Canvas 纸娃娃合成器——场景底图 + 主角图层 + 特效图层 → 合成单张图片
 *
 * 接口契约（06 文档 §5.4）：
 * - 合成器只依赖 manifest.json + 文件路径，不硬编码任何素材 ID
 * - 确定性：同一组参数 → 同一张合成图（无随机性，图层全是预生成的）
 * - 缺省回退链：精确组合缺失 → 按 age_band → outfit → pose 逐级回退到同 form 默认图层
 *
 * 图层叠合顺序（从底到顶）：
 *   1. 场景底图（4:3 宽高比，不透明背景）
 *   2. 主角图层（透明背景，居中偏下放置）
 *   3. 里程碑特效图层（透明背景，全屏覆盖）
 */

import {
  type Manifest,
  type ComposeParams,
  findScene,
  findActor,
  findEffect,
  loadImage,
  getManifest,
  loadManifest,
} from './manifest.ts';

const ASSET_BASE = './images/';

/** Canvas 输出尺寸（4:3 宽高比） */
export const CANVAS_WIDTH = 800;
export const CANVAS_HEIGHT = 600;

/**
 * 合成场景图片——场景底图 + 主角图层 + 特效图层
 *
 * @param params 合成参数（place/era/race/form/variety/age_band/outfit/pose/milestone?）
 * @returns 合成后的 HTMLCanvasElement，失败时返回 null
 */
export async function composeScene(params: ComposeParams): Promise<HTMLCanvasElement | null> {
  const manifest = getManifest() ?? (await loadManifest());

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  canvas.height = CANVAS_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 1. 绘制场景底图
  const scene = findScene(manifest, params.place, params.era);
  if (scene) {
    try {
      const img = await loadImage(`${ASSET_BASE}${scene.file}`);
      ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    } catch {
      // 场景底图加载失败：用纯色背景兜底
      ctx.fillStyle = params.era === 'ancient' ? '#2a2418' : '#1a1a2e';
      ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    }
  } else {
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  }

  // 2. 叠加主角图层（居中偏下，占画面高度 60%）
  const actor = findActor(manifest, params);
  if (actor) {
    try {
      const img = await loadImage(`${ASSET_BASE}${actor.file}`);
      const actorW = CANVAS_WIDTH * 0.5;
      const actorH = CANVAS_HEIGHT * 0.6;
      const actorX = (CANVAS_WIDTH - actorW) / 2;
      const actorY = CANVAS_HEIGHT - actorH - 20;
      ctx.drawImage(img, actorX, actorY, actorW, actorH);
    } catch {
      // 主角图层加载失败：静默跳过（已有场景底图兜底）
    }
  }

  // 3. 叠加里程碑特效图层（全屏覆盖）
  if (params.milestone) {
    const effect = findEffect(manifest, params.milestone);
    if (effect) {
      try {
        const img = await loadImage(`${ASSET_BASE}${effect.file}`);
        ctx.drawImage(img, 0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      } catch {
        // 特效图层加载失败：静默跳过
      }
    }
  }

  return canvas;
}

/**
 * 出生轴枚举归一化——引擎原始值为英文枚举（world.yaml birthAxes），
 * 此处同时容忍历史/测试用的中文标签，统一归一为 manifest 英文枚举。
 */
const PLACE_ALIASES: Record<string, string> = {
  forest: 'forest',
  city: 'city',
  guild_land: 'guild_land',
  hermit_island: 'hermit_island',
  '森林': 'forest',
  '城': 'city',
  '城市': 'city',
  '会馆领地': 'guild_land',
  '公会领地': 'guild_land',
  '隐修岛': 'hermit_island',
  '隐士岛': 'hermit_island',
};

const ERA_ALIASES: Record<string, string> = {
  ancient: 'ancient',
  modern: 'modern',
  '古代': 'ancient',
  '现代': 'modern',
};

/** region 枚举 → place 英文枚举（缺省 forest） */
export function normalizePlace(region: string): string {
  const key = Object.keys(PLACE_ALIASES).find((k) => region.includes(k));
  return key ? PLACE_ALIASES[key]! : 'forest';
}

/** era 枚举 → era 英文枚举（缺省 modern） */
export function normalizeEra(era: string): string {
  const key = Object.keys(ERA_ALIASES).find((k) => era.includes(k));
  return key ? ERA_ALIASES[key]! : 'modern';
}

/**
 * 从 BirthOutcome + PersonState 推导合成参数
 *
 * 将引擎 region/era 归一为 manifest 的英文枚举值
 */
export function deriveParams(birth: {
  form: string;
  species?: string;
  variety?: string;
  region: string;
  era: string;
}, tick: number, milestone?: string): ComposeParams {
  const place = normalizePlace(birth.region);
  const era = normalizeEra(birth.era);

  // tick → age_band
  let age_band = 'youth';
  if (tick <= 12) age_band = 'child';
  else if (tick <= 25) age_band = 'youth';
  else if (tick <= 60) age_band = 'adult';
  else age_band = 'elder';

  return {
    place,
    era,
    race: birth.form,
    form: birth.species,
    variety: birth.variety,
    age_band,
    outfit: 'plain_robe',
    pose: 'standing',
    milestone,
  };
}
