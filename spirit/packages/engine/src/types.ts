export type Attrs = Record<string, number>;

export interface AttrCond {
  gte?: number;
  lte?: number;
}

export interface EventCond {
  minTick?: number;
  maxTick?: number;
  attrs?: Record<string, AttrCond>;
  flags?: string[];
  /** 任一存在则不匹配（排除条件） */
  excludeFlags?: string[];
}

export interface ChoiceOption {
  label: string;
  desc?: string;
  effects?: Attrs;
  weight?: number;
  weightShifts?: Record<string, number>;
  gainFlags?: string[];
  /** 人格粒度轴倾向：grainAxis → +1（左极）/ -1（右极） */
  grainShifts?: Record<string, number>;
}

export interface Choice {
  prompt: string;
  options: ChoiceOption[];
}

export interface EventEffects extends Attrs {}

export interface WorldEvent {
  id: string;
  label: string;
  weight: number;
  cond?: EventCond;
  /** 每人一生仅触发一次（抉择事件、关键突破事件） */
  once?: boolean;
  /** 冷却 tick 数：触发后 N tick 内不再进入候选池（日常事件） */
  cooldownTicks?: number;
  effects?: EventEffects;
  gainFlags?: string[];
  lossFlags?: string[];
  choice?: Choice;
  terminal?: boolean;
  firstFlag?: string;
  source?: 'events' | 'scenes' | 'shocks';
}

export interface HazardBand {
  fromTick: number;
  hazard: number;
}

export interface FormDeathRule {
  /** 完全覆盖全局 bands 的形态专属危害曲线 */
  bands?: HazardBand[];
  attrDeath?: { attr: string; below: number };
  attrMod?: { attr: string; below: number; multiplier: number };
  /** 形态寿命系数：作用于计算后的 hazard，<1 表示寿长 */
  multiplier?: number;
}

export interface DeathRule {
  bands: HazardBand[];
  attrDeath?: { attr: string; below: number };
  attrMod?: { attr: string; below: number; multiplier: number };
  /** 按形态覆盖/缩放危害曲线（key 为出生形态，如 plant_yao） */
  forms?: Record<string, FormDeathRule>;
  /** 修行者寿命加成：有 cultivator flag 时 hazard 乘以此系数（<1 延寿） */
  cultivatorMultiplier?: number;
}

export interface World {
  name: string;
  tickName: string;
  startTick: number;
  endTick: number;
  initAttrs: Attrs;
  events: WorldEvent[];
  deathRule: DeathRule;
  deathModel?: 'lifetable' | 'liquality_balance';
  preBirthChain?: PreBirthChain;
  birthForm?: BirthForm;
  birthAxes?: BirthAxes;
  cultivationGate?: CultivationGate;
  talent?: Talent;
  powerLadder?: PowerLadder;
  hardThresholds?: HardThresholds;
  orgAffiliation?: OrgAffiliation;
  namingSkins?: NamingSkins;
  narrativeFeed?: NarrativeFeed;
  narratives?: Narratives;
  spiritDensity?: SpiritDensity;
  presentation?: Presentation;
  choiceAxes?: string[];
  grainAxes?: string[];
}

export type DeathModel = 'lifetable' | 'liquality_balance';

export interface Presentation {
  demoWeights: boolean;
  realRatio: string;
  uiNote: string;
}

export interface PreBirthChain {
  stages: string[];
  shengling: { p: Record<string, number> };
  jingling: { fate: string[] };
  condense: { prototype: string[] };
  rareLine?: { reincarnatedSoulP: number };
  humanLine?: string;
}

export interface BirthForm {
  weights: Record<string, number>;
  speciesPrototype: Record<string, string[]>;
  speciesVariety?: Record<string, string[]>;
  niche: string[];
}

export interface BirthAxes {
  region: string[];
  era: string[];
}

export interface CultivationGate {
  step1LiqiManifestP: number;
  step2EntryEventP: number;
  entryEventAgeWindow: [number, number];
}

export interface Talent {
  lixi: Record<string, number>;
  dualLiqualityP: number;
  spaceLixi: { acquired: boolean };
  envModifier?: Record<string, Record<string, number>>;
}

export interface TierGate {
  event: string;
  p?: number;
  requires?: string;
  terminal?: boolean;
}

export interface PowerLadder {
  tiers: string[];
  tierGates: Record<string, TierGate>;
  quantTables?: { scaleCap?: number };
}

export interface HardThresholds {
  t1SubabilityLocked?: { rule: string };
  t2SpaceDeathBound?: { rule: string; exception?: string; boundLixi?: string };
  t3DualEssence?: { rarity: string };
  multiSystemCap?: Record<string, string>;
  healSystemWorldwide?: number;
}

export type OrgAffiliation = Record<string, Record<string, string>>;

export interface NamingSkins {
  rule: string;
  tierGate?: { min: string };
  skins?: Record<string, { race: string; tierMin: string; p: number }>;
  skillNamePools?: { sources: string[]; usage: string };
}

export interface NarrativeFeed {
  rule: string;
  trigger: string;
  milestones: string[];
  payload?: string[];
  text?: string;
  image?: {
    pipeline: string;
    styleLock: string;
    compose: string;
    actorParams: string[];
    libraryBudget?: number;
  };
}

export interface SpiritDensity {
  landmarks: Record<string, number>;
  effect: string;
}

export interface NarrativeVariant {
  id: string;
  text: string;
}

export interface NarrativeWhen {
  form?: string;
  region?: string;
  era?: string;
  cultivator?: boolean;
  flags?: string[];
  /** 叙事桶的 tick 下限（用于区分童年/成人等年龄段的叙事变体） */
  minTick?: number;
  /** 叙事桶的 tick 上限 */
  maxTick?: number;
}

export interface NarrativeBucket {
  when?: NarrativeWhen;
  variants: NarrativeVariant[];
}

export interface EventNarratives {
  prompt?: string;
  fallback?: NarrativeVariant[];
  buckets?: NarrativeBucket[];
}

export interface InterludeCategory {
  /** 触发的最小 tick（不含出生前日志） */
  minTick?: number;
  /** 触发的最大 tick */
  maxTick?: number;
  /** 仅修行者可见 */
  cultivatorOnly?: boolean;
  /** 仅凡人可见 */
  mortalOnly?: boolean;
  /** 变体列表 */
  variants: NarrativeVariant[];
}

export interface Narratives {
  version: number;
  slots?: Record<string, Record<string, string>>;
  openers?: NarrativeVariant[];
  closers?: NarrativeVariant[];
  events?: Record<string, EventNarratives>;
  milestones?: Record<string, NarrativeVariant[]>;
  /** 插页——他人动态/坊间传闻，穿插在人生日志中增添世界感 */
  interludes?: Record<string, InterludeCategory>;
}

export const NARRATIVE_SLOTS = ['place', 'species', 'variety', 'niche', 'era'] as const;

export interface BirthOutcome {
  form: string;
  species?: string;
  variety?: string;
  niche?: string;
  region: string;
  era: string;
  lixi?: string;
  dualLixi: boolean;
  reincarnatedSoul: boolean;
  liqiManifest: boolean;
  cultivator: boolean;
  preBirthLog: LogEntry[];
}

export interface BatchStats {
  count: number;
  worldName: string;
  formDist: Record<string, number>;
  lixiDist: Record<string, number>;
  cultivatorRate: number;
  deathCauseDist: Record<string, number>;
  terminalDist: Record<string, number>;
  avgDeathTick: number;
  tierDist: Record<string, number>;
}

export interface LogEntry {
  tick: number;
  eventId: string;
  label: string;
  effects?: EventEffects;
  choice?: { prompt: string; picked: string };
}

export interface PersonState {
  tick: number;
  alive: boolean;
  attrs: Attrs;
  flags: string[];
  shifts: Record<string, number>;
  /** 人格粒度轴累积值：grainAxis → 正数（左极）/ 负数（右极） */
  grainShifts: Record<string, number>;
  /** 已触发过的 once 事件 id 集合 */
  firedEvents: Set<string>;
  /** 事件 id → 冷却截止 tick（该 tick 之前不可再触发） */
  cooldownUntil: Record<string, number>;
}

export interface LifeResult {
  world: string;
  seed: number;
  state: PersonState;
  log: LogEntry[];
  deathTick: number | null;
  deathCause: string;
  birth?: BirthOutcome;
  pausedChoice?: Choice;
  /** 暂停抉择对应的事件 id——供叙事层渲染 prompt */
  pausedEventId?: string;
  /** 人生纹理（16 种之一，仅活到成年 tick≥18 才有值） */
  texture?: LifeTexture;
}

/** 人生纹理：4 条粒度轴 × 2 极 = 16 种组合 */
export interface LifeTexture {
  /** 4 位编码，每位对应一条 grainAxis：0=左极，1=右极 */
  code: string;
  /** 4 字标签（每条轴取极字首字） */
  label: string;
  /** 纹理描述文案 */
  desc: string;
  /** 五言诗句（两句十字），为每种纹理专属 */
  verse: string;
}
