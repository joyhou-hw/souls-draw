import type { BirthOutcome, Choice, EventCond, LifeResult, LogEntry, PersonState, World, WorldEvent } from './types.ts';
import { createRng, type Rng, type WeightedEntry } from './rng.ts';
import { birthFlags, generateBirth } from './birth.ts';

export function matchCond(cond: EventCond | undefined, state: PersonState): boolean {
  if (!cond) return true;
  if (cond.minTick !== undefined && state.tick < cond.minTick) return false;
  if (cond.maxTick !== undefined && state.tick > cond.maxTick) return false;
  if (cond.flags) {
    for (const f of cond.flags) {
      if (!state.flags.includes(f)) return false;
    }
  }
  if (cond.excludeFlags) {
    for (const f of cond.excludeFlags) {
      if (state.flags.includes(f)) return false;
    }
  }
  if (cond.attrs) {
    for (const [name, c] of Object.entries(cond.attrs)) {
      const v = state.attrs[name] ?? 0;
      if (c.gte !== undefined && v < c.gte) return false;
      if (c.lte !== undefined && v > c.lte) return false;
    }
  }
  return true;
}

export function currentWeight(event: WorldEvent, state: PersonState): number {
  const shift = state.shifts[event.id] ?? 1;
  return Math.max(0, event.weight * shift);
}

export function autoResolveChoice(choice: Choice, _state: PersonState, rng: Rng): number {
  return rng.weightedPick(
    choice.options.map((o, i) => ({ item: i, weight: o.weight ?? 1 })),
  );
}

export function candidateEvents(world: World, state: PersonState): WorldEvent[] {
  return world.events.filter((e) => {
    if (!matchCond(e.cond, state)) return false;
    // once 事件：已触发过则排除
    if (e.once && state.firedEvents.has(e.id)) return false;
    // 冷却期：当前 tick < 冷却截止 tick 则排除
    const cd = state.cooldownUntil[e.id];
    if (cd !== undefined && state.tick < cd) return false;
    return true;
  });
}

export function tierOf(state: PersonState): string | undefined {
  let tier: string | undefined;
  for (const f of state.flags) {
    if (f.startsWith('tier:')) tier = f.slice(5);
  }
  return tier;
}

function formOf(state: PersonState): string | undefined {
  for (const f of state.flags) {
    if (f.startsWith('form:')) return f.slice(5);
  }
  return undefined;
}

export function deathCheck(world: World, state: PersonState, rng: Rng): string | null {
  const rule = world.deathRule;
  if (world.deathModel === 'liquality_balance') {
    const liquality = state.attrs['liquality'];
    if (liquality !== undefined && liquality <= 0) {
      return 'liquality_exhausted';
    }
  }
  const health = state.attrs['health'];
  const form = formOf(state);
  const override = form ? rule.forms?.[form] : undefined;
  const attrDeath = override?.attrDeath ?? rule.attrDeath;
  if (attrDeath && health !== undefined && health < attrDeath.below) {
    return 'health';
  }
  const bands = override?.bands ?? rule.bands;
  let hazard = bands.reduce((acc, b) => (state.tick >= b.fromTick ? b.hazard : acc), 0);
  const attrMod = override?.attrMod ?? rule.attrMod;
  if (attrMod) {
    const v = state.attrs[attrMod.attr] ?? health;
    if (v !== undefined && v < attrMod.below) {
      hazard *= attrMod.multiplier;
    }
  }
  if (override?.multiplier !== undefined) {
    hazard *= override.multiplier;
  }
  if (rng.next() < hazard) return 'hazard';
  return null;
}

export interface RunLifeOptions {
  seed?: number;
  rng?: Rng;
  resolveChoice?: (choice: Choice, state: PersonState, rng: Rng) => number;
}

export function runLife(world: World, opts: RunLifeOptions = {}): LifeResult {
  const rng = opts.rng ?? createRng(opts.seed ?? 0);
  const resolveChoice = opts.resolveChoice ?? autoResolveChoice;
  const state: PersonState = {
    tick: world.startTick,
    alive: true,
    attrs: { ...world.initAttrs },
    flags: [],
    shifts: {},
    grainShifts: {},
    firedEvents: new Set<string>(),
    cooldownUntil: {},
  };
  const log: LogEntry[] = [];
  let birth: BirthOutcome | undefined;
  if (world.birthForm) {
    birth = generateBirth(world, rng);
    for (const f of birthFlags(birth)) {
      if (!state.flags.includes(f)) state.flags.push(f);
    }
    log.push(...birth.preBirthLog);
  }
  let deathCause: string | null = null;
  for (let t = world.startTick + 1; t <= world.endTick && state.alive; t++) {
    state.tick = t;
    const pool: WeightedEntry<WorldEvent>[] = candidateEvents(world, state)
      .map((e) => ({ item: e, weight: currentWeight(e, state) }))
      .filter((p) => p.weight > 0);
    if (pool.length > 0) {
      const ev = rng.weightedPick(pool);
      const entry: LogEntry = { tick: t, eventId: ev.id, label: ev.label };
      if (ev.effects) {
        entry.effects = ev.effects;
        applyAttrs(state, ev.effects);
      }
      if (ev.gainFlags) {
        for (const f of ev.gainFlags) {
          if (!state.flags.includes(f)) state.flags.push(f);
        }
      }
      if (ev.lossFlags) {
        const lost = applyLossFlags(state, ev.lossFlags);
        if (lost.length > 0) {
          const t2 = world.hardThresholds?.t2SpaceDeathBound;
          if (t2?.rule === 'space_loss_equals_death') {
            const boundLixi = t2.boundLixi ?? 'space';
            const lostBound = lost.includes(`lixi:${boundLixi}`);
            if (lostBound) {
              if (t2.exception === 'dual_essence' && state.flags.includes('dual_lix')) {
                entry.label = `${entry.label}（双灵质例外：失去灵系而幸存）`;
              } else {
                state.alive = false;
                deathCause = 'space_lixi_lost';
              }
            }
          }
        }
      }
      if (ev.choice) {
        const idx = resolveChoice(ev.choice, state, rng);
        if (idx < 0) {
          return {
            world: world.name,
            seed: opts.seed ?? rng.seed,
            state,
            log,
            deathTick: state.alive ? null : state.tick,
            deathCause: deathCause ?? '',
            birth,
            pausedChoice: ev.choice,
            pausedEventId: ev.id,
          };
        }
        const opt = ev.choice.options[idx]!;
        entry.choice = { prompt: ev.choice.prompt, picked: opt.label };
        if (opt.effects) {
          applyAttrs(state, opt.effects);
          entry.effects = { ...(entry.effects ?? {}), ...opt.effects };
        }
        if (opt.gainFlags) {
          for (const f of opt.gainFlags) {
            if (!state.flags.includes(f)) state.flags.push(f);
          }
        }
        if (opt.weightShifts) {
          for (const [id, m] of Object.entries(opt.weightShifts)) {
            state.shifts[id] = (state.shifts[id] ?? 1) * m;
          }
        }
        if (opt.grainShifts) {
          for (const [axis, delta] of Object.entries(opt.grainShifts)) {
            state.grainShifts[axis] = (state.grainShifts[axis] ?? 0) + delta;
          }
        }
      }
      log.push(entry);
      // once 事件：标记已触发
      if (ev.once) state.firedEvents.add(ev.id);
      // 冷却事件：设置冷却截止 tick
      if (ev.cooldownTicks) state.cooldownUntil[ev.id] = t + ev.cooldownTicks;
      if (ev.terminal) {
        state.alive = false;
        deathCause = `terminal:${ev.id}`;
      }
    }
    if (state.alive) {
      const cause = deathCheck(world, state, rng);
      if (cause !== null) {
        state.alive = false;
        deathCause = cause;
      }
    }
  }
  // 人生纹理：仅活到成年（tick≥18）才有
  const texture = state.tick >= 18 ? computeLifeTexture(state.grainShifts, world.grainAxes) : undefined;
  return {
    world: world.name,
    seed: opts.seed ?? rng.seed,
    state,
    log,
    deathTick: state.alive ? null : state.tick,
    deathCause: deathCause ?? '',
    birth,
    texture,
  };
}

function applyAttrs(state: PersonState, effects: Record<string, number>): void {
  for (const [k, v] of Object.entries(effects)) {
    state.attrs[k] = (state.attrs[k] ?? 0) + v;
  }
}

function applyLossFlags(state: PersonState, flags: string[]): string[] {
  const lost: string[] = [];
  for (const f of flags) {
    const i = state.flags.indexOf(f);
    if (i >= 0) {
      state.flags.splice(i, 1);
      lost.push(f);
    }
  }
  return lost;
}

export function hashLife(result: LifeResult): string {
  const s = JSON.stringify({
    log: result.log,
    attrs: result.state.attrs,
    flags: result.state.flags,
    deathTick: result.deathTick,
    deathCause: result.deathCause,
  });
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ═══════════════════════════════════════════════
// 人生纹理（16 种）：4 条 grainAxes × 2 极
// ═══════════════════════════════════════════════

/** 每条轴的左极词（+）和右极词（−） */
const GRAIN_POLARITIES: Record<string, [string, string]> = {
  rooted_vs_drifting: ['扎根', '漂泊'],
  kin_vs_recluse: ['合群', '隐逸'],
  order_vs_radical: ['守序', '激进'],
  coexist_vs_solo: ['共处', '独行'],
};

/** 16 种纹理描述（按 code → desc，code 格式 "XXXX"，每位 0=左极/1=右极） */
const TEXTURE_DESCS: Record<string, string> = {
  '0000': '安土重迁，群居和顺，循规蹈矩，与世共处——这是最安稳的一生',
  '0001': '安土重迁，群居和顺，循规蹈矩，却偏爱独走自己的路',
  '0010': '安土重迁，群居和顺，却心中激进，与世共处中暗藏锋芒',
  '0011': '安土重迁，群居和顺，行事激进，独走逆行——温和表象下的叛逆',
  '0100': '安土重迁，群居和顺，却偏守序孤行——看似合群实则疏离',
  '0101': '安土重迁，合群守矩，独善其身——社区中的安静一隅',
  '0110': '安土重迁，合群却激进，与世共处——乡土中的变革者',
  '0111': '安土重迁，合群激进，独走己路——不安分的乡邻',
  '1000': '安土重迁，却天性隐逸，守序共处——喧嚣中的沉默者',
  '1001': '安土重迁，隐逸守矩，独行于世——山中隐士的雏形',
  '1010': '安土重迁，隐逸激进，与世共处——不问世俗却心系天下',
  '1011': '安土重迁，隐逸激进，独走己路——山林中的孤狼',
  '1100': '安土重迁，隐逸守序，与世共处——矛盾而平和的隐者',
  '1101': '安土重迁，隐逸守序，独行于世——最彻底的隐居者',
  '1110': '安土重迁，隐逸激进，与世共处——隐于野而心激荡',
  '1111': '安土重迁，隐逸激进，独走己路——彻底的独行者',
};

/** 16 种纹理描述（漂泊系，code 首位为 1） */
const TEXTURE_DESCS_DRIFT: Record<string, string> = {
  '0000': '漂泊天涯，合群守序，与世共处——四海为家的温和旅人',
  '0001': '漂泊天涯，合群守序，独走天涯——人群中独行',
  '0010': '漂泊天涯，合群激进，与世共处——路途中的变革者',
  '0011': '漂泊天涯，合群激进，独走己路——流亡中的斗士',
  '0100': '漂泊天涯，合群守序，与世共处——漂泊中的和事佬',
  '0101': '漂泊天涯，合群守矩，独善其身——漂泊中的旁观者',
  '0110': '漂泊天涯，合群激进，与世共处——流浪中的鼓动者',
  '0111': '漂泊天涯，合群激进，独走己路——逆流的浪人',
  '1000': '漂泊天涯，隐逸守序，与世共处——沉默的行者',
  '1001': '漂泊天涯，隐逸守矩，独行于世——天涯孤客',
  '1010': '漂泊天涯，隐逸激进，与世共处——心怀天下的游荡者',
  '1011': '漂泊天涯，隐逸激进，独走己路——荒野中的反叛者',
  '1100': '漂泊天涯，隐逸守序，与世共处——漂泊隐者的平和',
  '1101': '漂泊天涯，隐逸守序，独行于世——彻底的流浪隐士',
  '1110': '漂泊天涯，隐逸激进，与世共处——不羁的游魂',
  '1111': '漂泊天涯，隐逸激进，独走己路——最自由的独行者',
};

/**
 * 从 grainShifts 累积值计算人生纹理（16 种之一）
 *
 * 每条轴：累积值 ≥ 0 → 左极（0），< 0 → 右极（1）
 * 4 条轴组合为 4 位 code → 16 种纹理
 */
export function computeLifeTexture(
  grainShifts: Record<string, number>,
  grainAxes?: string[],
): import('./types.ts').LifeTexture {
  const axes = grainAxes ?? ['rooted_vs_drifting', 'kin_vs_recluse', 'order_vs_radical', 'coexist_vs_solo'];
  const bits: number[] = [];
  const labels: string[] = [];
  for (const axis of axes) {
    const val = grainShifts[axis] ?? 0;
    const [left, right] = GRAIN_POLARITIES[axis] ?? ['左', '右'];
    if (val >= 0) {
      bits.push(0);
      labels.push(left);
    } else {
      bits.push(1);
      labels.push(right);
    }
  }
  const code = bits.map((b) => String(b)).join('');
  const isDrift = bits[0] === 1;
  const descPool = isDrift ? TEXTURE_DESCS_DRIFT : TEXTURE_DESCS;
  const subCode = code.slice(1);
  const desc = descPool[subCode] ?? TEXTURE_DESCS[code] ?? '不可名状的一生';
  return { code, label: labels.join(''), desc };
}
