/**
 * 叙事渲染器（T3.2 + T3.3）
 *
 * 四板斧（01 §6.2）实现：
 * 1. 槽位模板化——{place}/{species}/{niche}/{era} 替换为出生轴实际值
 * 2. 条件桶——按出生形态/地区/时代/修行位匹配桶，先匹配先赢，fallback 兜底
 * 3. 不放回抽样——单人生内已出现的变体不再出现
 * 4. 碎片拼接——opener + 事件句 + closer 自由组合
 *
 * 铁律：render_only——只读叙事库与人生状态，不回写 p 值/属性/事件池。
 */
import type {
  BirthOutcome,
  EventNarratives,
  NarrativeBucket,
  NarrativeVariant,
  Narratives,
  NarrativeWhen,
  PersonState,
  World,
} from './types.ts';
import { NARRATIVE_SLOTS } from './types.ts';
import type { Rng } from './rng.ts';

const SLOT_RE = /\{([a-z_]+)\}/g;

/** 槽位上下文——由 BirthOutcome 提取 */
export interface SlotContext {
  form: string; // birthOutcome.form（用于桶匹配 when.form）
  place: string; // birthOutcome.region 原始枚举值
  species: string; // species 精细值优先，否则 form（用于文本呈现 {species} 槽位）
  variety: string; // birthOutcome.variety ?? ''（纯文本呈现，不参与桶匹配）
  niche: string; // birthOutcome.niche ?? ''
  era: string; // birthOutcome.era
}

/** 从出生结果提取槽位上下文 */
export function buildSlotContext(birth: BirthOutcome | undefined): SlotContext | undefined {
  if (!birth) return undefined;
  return {
    form: birth.form,
    place: birth.region,
    species: birth.species ?? birth.form,
    variety: birth.variety ?? '',
    niche: birth.niche ?? '',
    era: birth.era,
  };
}

/** 查 slots 映射表，缺省回退原始枚举值 */
function resolveSlotValue(
  slotName: string,
  enumKey: string,
  slots: Record<string, Record<string, string>> | undefined,
): string {
  return slots?.[slotName]?.[enumKey] ?? enumKey;
}

/** 槽位模板替换——把 {place} 等替换为 slots 映射后的中文呈现 */
export function renderText(
  template: string,
  ctx: SlotContext | undefined,
  slots: Record<string, Record<string, string>> | undefined,
): string {
  if (!ctx) return template;
  return template.replace(SLOT_RE, (_, name: string) => {
    const raw = ctx[name as keyof SlotContext] ?? '';
    return resolveSlotValue(name, raw, slots);
  });
}

/** 条件桶匹配——先匹配先赢 */
function matchBuckets(
  buckets: NarrativeBucket[] | undefined,
  ctx: SlotContext,
  state: PersonState,
): NarrativeBucket | undefined {
  if (!buckets || buckets.length === 0) return undefined;
  for (const bucket of buckets) {
    if (matchWhen(bucket.when, ctx, state)) return bucket;
  }
  return undefined;
}

function matchWhen(
  when: NarrativeWhen | undefined,
  ctx: SlotContext,
  state: PersonState,
): boolean {
  if (!when) return true;
  if (when.form !== undefined && when.form !== ctx.form) return false;
  if (when.region !== undefined && when.region !== ctx.place) return false;
  if (when.era !== undefined && when.era !== ctx.era) return false;
  if (when.cultivator !== undefined) {
    const isCultivator = state.flags.includes('cultivator');
    if (when.cultivator !== isCultivator) return false;
  }
  if (when.flags) {
    for (const f of when.flags) {
      if (!state.flags.includes(f)) return false;
    }
  }
  return true;
}

/**
 * 叙事渲染器状态——单人生内维护不放回抽样集
 * 每个 NarrativeVariant.id 全局唯一，已出现的不再复用
 */
export class NarrativeRenderer {
  private readonly narratives: Narratives | undefined;
  private readonly ctx: SlotContext | undefined;
  private readonly usedIds = new Set<string>();

  constructor(world: World, birth: BirthOutcome | undefined) {
    this.narratives = world.narratives;
    this.ctx = buildSlotContext(birth);
  }

  /** 是否已配置叙事库 */
  get available(): boolean {
    return this.narratives !== undefined;
  }

  /** 槽位上下文（测试与调试用） */
  get context(): SlotContext | undefined {
    return this.ctx;
  }

  /** 渲染一条事件叙事——返回拼接后的完整句子（opener + 事件句 + closer） */
  renderEvent(
    eventId: string,
    state: PersonState,
    rng: Rng,
  ): string | undefined {
    if (!this.narratives?.events) return undefined;
    const cfg = this.narratives.events[eventId];
    if (!cfg) return undefined;
    const variant = this.pickEventVariant(cfg, state, rng);
    if (!variant) return undefined;
    const sentence = this.renderVariant(variant);
    return this.wrapWithFragments(sentence, rng);
  }

  /** 渲染抉择事件的 prompt——prompt 是单条提示语，不走不放回抽样 */
  renderPrompt(
    eventId: string,
    state: PersonState,
  ): string | undefined {
    if (!this.narratives?.events) return undefined;
    const cfg = this.narratives.events[eventId];
    if (!cfg?.prompt) return undefined;
    return renderText(cfg.prompt, this.ctx, this.narratives.slots);
  }

  /** 渲染里程碑题注（T3.5 预留接口） */
  renderMilestone(
    milestoneId: string,
    state: PersonState,
    rng: Rng,
  ): string | undefined {
    if (!this.narratives?.milestones) return undefined;
    const list = this.narratives.milestones[milestoneId];
    if (!list || list.length === 0) return undefined;
    const available = list.filter((v) => !this.usedIds.has(v.id));
    if (available.length === 0) {
      // 不放回抽空时回退——允许复用（里程碑题注总量小，复用可接受）
      const variant = rng.pick(list);
      return this.renderVariant(variant);
    }
    const variant = rng.pick(available);
    this.usedIds.add(variant.id);
    return this.renderVariant(variant);
  }

  /** 渲染单个变体（槽位替换，无碎片拼接） */
  private renderVariant(variant: NarrativeVariant): string {
    return renderText(variant.text, this.ctx, this.narratives?.slots);
  }

  /** 从事件配置中挑选变体——条件桶优先、fallback 兜底、不放回抽样 */
  private pickEventVariant(
    cfg: EventNarratives,
    state: PersonState,
    rng: Rng,
  ): NarrativeVariant | undefined {
    if (!this.ctx) return undefined;
    const bucket = matchBuckets(cfg.buckets, this.ctx, state);
    const pool = bucket?.variants ?? cfg.fallback;
    if (!pool || pool.length === 0) return undefined;
    const available = pool.filter((v) => !this.usedIds.has(v.id));
    if (available.length === 0) {
      // 桶内不放回抽空——回退到全池复用（保证叙事连续性优先于零重复）
      return rng.pick(pool);
    }
    const variant = rng.pick(available);
    this.usedIds.add(variant.id);
    return variant;
  }

  /** 碎片拼接——opener + sentence + closer（各 50% 概率缀加） */
  private wrapWithFragments(sentence: string, rng: Rng): string {
    let result = sentence;
    if (this.narratives?.openers && this.narratives.openers.length > 0 && rng.next() < 0.5) {
      const opener = rng.pick(this.narratives.openers);
      const rendered = this.renderVariant(opener);
      result = rendered + result;
    }
    if (this.narratives?.closers && this.narratives.closers.length > 0 && rng.next() < 0.3) {
      const closer = rng.pick(this.narratives.closers);
      const rendered = this.renderVariant(closer);
      result = result + rendered;
    }
    return result;
  }
}
