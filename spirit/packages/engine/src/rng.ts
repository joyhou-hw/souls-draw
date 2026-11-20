export interface WeightedEntry<T> {
  item: T;
  weight: number;
}

export interface Rng {
  readonly seed: number;
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  weightedPick<T>(entries: readonly WeightedEntry<T>[]): T;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng: Rng = {
    seed,
    next,
    int: (maxExclusive: number) => Math.floor(next() * maxExclusive),
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('Rng.pick: 空数组');
      return items[Math.floor(next() * items.length)] as T;
    },
    weightedPick: <T>(entries: readonly WeightedEntry<T>[]): T => {
      const total = entries.reduce((s, e) => s + e.weight, 0);
      if (total <= 0) throw new Error('Rng.weightedPick: 总权重必须为正');
      let roll = next() * total;
      for (const e of entries) {
        roll -= e.weight;
        if (roll < 0) return e.item;
      }
      return entries[entries.length - 1]!.item;
    },
  };
  return rng;
}
