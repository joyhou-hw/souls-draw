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

const ASSET_BASE = './assets/images/';

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
 * 从 BirthOutcome + PersonState 推导合成参数
 *
 * 将引擎的中文 region/era/form 转换为 manifest 的英文枚举值
 */
export function deriveParams(birth: {
  form: string;
  species?: string;
  variety?: string;
  region: string;
  era: string;
}, tick: number, milestone?: string): ComposeParams {
  // region 中文 → place 英文
  const placeMap: Record<string, string> = {
    '森林': 'forest', '城': 'city', '公会领地': 'guild_land', '隐士岛': 'hermit_island',
  };
  const place = Object.entries(placeMap).find(([k]) => birth.region.includes(k))?.[1] ?? 'forest';
  const era = birth.era.includes('古') ? 'ancient' : 'modern';

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
