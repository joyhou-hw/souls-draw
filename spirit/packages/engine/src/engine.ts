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
  return world.events.filter((e) => matchCond(e.cond, state));
}

export function tierOf(state: PersonState): string | undefined {
  let tier: string | undefined;
  for (const f of state.flags) {
    if (f.startsWith('tier:')) tier = f.slice(5);
  }
  return tier;
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
  if (rule.attrDeath && health !== undefined && health < rule.attrDeath.below) {
    return 'health';
  }
  let hazard = rule.bands.reduce((acc, b) => (state.tick >= b.fromTick ? b.hazard : acc), 0);
  if (rule.attrMod) {
    const v = state.attrs[rule.attrMod.attr] ?? health;
    if (v !== undefined && v < rule.attrMod.below) {
      hazard *= rule.attrMod.multiplier;
    }
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
          };
        }
        const opt = ev.choice.options[idx]!;
        entry.choice = { prompt: ev.choice.prompt, picked: opt.label };
        if (opt.effects) applyAttrs(state, opt.effects);
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
      }
      log.push(entry);
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
  return {
    world: world.name,
    seed: opts.seed ?? rng.seed,
    state,
    log,
    deathTick: state.alive ? null : state.tick,
    deathCause: deathCause ?? '',
    birth,
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
