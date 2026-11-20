import { runLife, tierOf } from './engine.ts';
import type { BatchStats, World } from './types.ts';

export interface RunBatchOptions {
  count: number;
  seedStart?: number;
  chunkSize?: number;
  onProgress?: (done: number, total: number) => void;
}

export function runBatch(world: World, opts: RunBatchOptions): BatchStats {
  const count = opts.count;
  const seedStart = opts.seedStart ?? 0;
  const chunkSize = Math.max(1, opts.chunkSize ?? count);
  const onProgress = opts.onProgress;
  const stats: BatchStats = {
    count,
    worldName: world.name,
    formDist: {},
    lixiDist: {},
    cultivatorRate: 0,
    deathCauseDist: {},
    terminalDist: {},
    avgDeathTick: 0,
    tierDist: {},
  };
  let cultivators = 0;
  let tickSum = 0;
  const terminalIds = new Set(world.events.filter((e) => e.terminal).map((e) => e.id));
  for (let i = 0; i < count; i++) {
    const r = runLife(world, { seed: seedStart + i });
    if (r.birth) {
      stats.formDist[r.birth.form] = (stats.formDist[r.birth.form] ?? 0) + 1;
      if (r.birth.lixi) {
        stats.lixiDist[r.birth.lixi] = (stats.lixiDist[r.birth.lixi] ?? 0) + 1;
      }
      if (r.birth.cultivator) cultivators++;
    }
    const cause = r.deathCause || 'alive_end';
    stats.deathCauseDist[cause] = (stats.deathCauseDist[cause] ?? 0) + 1;
    tickSum += r.deathTick ?? world.endTick;
    const tier = tierOf(r.state);
    if (tier) stats.tierDist[tier] = (stats.tierDist[tier] ?? 0) + 1;
    for (const e of r.log) {
      if (terminalIds.has(e.eventId)) {
        stats.terminalDist[e.eventId] = (stats.terminalDist[e.eventId] ?? 0) + 1;
      }
    }
    if (onProgress && (i + 1) % chunkSize === 0) onProgress(i + 1, count);
  }
  if (onProgress && count % chunkSize !== 0) onProgress(count, count);
  stats.cultivatorRate = count > 0 ? cultivators / count : 0;
  stats.avgDeathTick = count > 0 ? tickSum / count : 0;
  return stats;
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function statsToCsv(stats: BatchStats): string {
  const rows: string[] = ['section,key,value'];
  rows.push(`meta,count,${stats.count}`);
  rows.push(`meta,world,${csvEscape(stats.worldName)}`);
  rows.push(`meta,cultivatorRate,${stats.cultivatorRate.toFixed(4)}`);
  rows.push(`meta,avgDeathTick,${stats.avgDeathTick.toFixed(2)}`);
  for (const [k, v] of Object.entries(stats.formDist)) rows.push(`formDist,${csvEscape(k)},${v}`);
  for (const [k, v] of Object.entries(stats.lixiDist)) rows.push(`lixiDist,${csvEscape(k)},${v}`);
  for (const [k, v] of Object.entries(stats.deathCauseDist)) {
    rows.push(`deathCauseDist,${csvEscape(k)},${v}`);
  }
  for (const [k, v] of Object.entries(stats.terminalDist)) rows.push(`terminalDist,${csvEscape(k)},${v}`);
  for (const [k, v] of Object.entries(stats.tierDist)) rows.push(`tierDist,${csvEscape(k)},${v}`);
  return rows.join('\n') + '\n';
}
