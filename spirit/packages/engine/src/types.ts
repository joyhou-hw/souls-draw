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

export interface DeathRule {
  bands: HazardBand[];
  attrDeath?: { attr: string; below: number };
  attrMod?: { attr: string; below: number; multiplier: number };
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

export interface Narratives {
  version: number;
  slots?: Record<string, Record<string, string>>;
  openers?: NarrativeVariant[];
  closers?: NarrativeVariant[];
  events?: Record<string, EventNarratives>;
  milestones?: Record<string, NarrativeVariant[]>;
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
}
