import { runLife } from '../../engine/src/engine.ts';
import type { LifeResult, World } from '../../engine/src/types.ts';

export function runSegment(world: World, seed: number, picked: number[]): LifeResult {
  let used = 0;
  return runLife(world, {
    seed,
    resolveChoice: (_c, _s, _r) => (used < picked.length ? picked[used++]! : -1),
  });
}
