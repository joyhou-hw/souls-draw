import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadWorldFile } from '../../dsl/src/load.ts';
import { runBatch, statsToCsv } from './batch.ts';

const worldPath = fileURLToPath(new URL('../../../worlds/luoxiaohei/world.yaml', import.meta.url));
const world = loadWorldFile(worldPath, { strict: 'luoxiaohei' });

test('T2.6 DoD：罗小黑世界 1,000 条批量人生跑通（计数守恒 + 终年区间）', () => {
  const stats = runBatch(world, { count: 1000 });
  assert.equal(stats.count, 1000);
  const formTotal = Object.values(stats.formDist).reduce((a, b) => a + b, 0);
  assert.equal(formTotal, 1000, 'formDist 总和必须等于 count（每条人生恰好一形态）');
  const causeTotal = Object.values(stats.deathCauseDist).reduce((a, b) => a + b, 0);
  assert.equal(causeTotal, 1000, 'deathCauseDist 总和必须等于 count');
  assert.ok(stats.avgDeathTick > world.startTick && stats.avgDeathTick <= world.endTick);
  assert.ok(stats.cultivatorRate > 0 && stats.cultivatorRate < 1);
});

test('T2.6 批量形态分布 ≈ birthForm 权重表（±0.05）', () => {
  const stats = runBatch(world, { count: 1000 });
  const w = world.birthForm!.weights;
  const total = Object.values(w).reduce((a, b) => a + b, 0);
  for (const [form, weight] of Object.entries(w)) {
    const actual = (stats.formDist[form] ?? 0) / stats.count;
    const expected = weight / total;
    assert.ok(
      Math.abs(actual - expected) < 0.05,
      `形态 ${form} 偏离权重表：实际 ${actual.toFixed(3)} vs 期望 ${expected.toFixed(3)}`,
    );
  }
});

test('T2.6 修行者可入灵力阶梯：tierDist 非空且 cultivatorRate 合理', () => {
  const stats = runBatch(world, { count: 1000 });
  const tierTotal = Object.values(stats.tierDist).reduce((a, b) => a + b, 0);
  assert.ok(tierTotal > 0, '1,000 条中无人定档灵力阶梯（异常）');
  assert.ok(tierTotal <= 1000);
  const gate = world.cultivationGate!;
  const p = gate.step1LiqiManifestP * gate.step2EntryEventP;
  assert.ok(
    Math.abs(stats.cultivatorRate - p) < 0.04,
    `修行者率 ${stats.cultivatorRate.toFixed(3)} 偏离双闸乘积 ${p}`,
  );
});

test('铁律①批量版：同参数批量运行统计逐字段一致', () => {
  const s1 = runBatch(world, { count: 200, seedStart: 500 });
  const s2 = runBatch(world, { count: 200, seedStart: 500 });
  assert.equal(JSON.stringify(s1), JSON.stringify(s2));
});

test('T4.4 onProgress 分块进度回调：按 chunk 触发且不影响统计结果', () => {
  const plain = runBatch(world, { count: 250, seedStart: 900 });
  const calls: Array<[number, number]> = [];
  const withCb = runBatch(world, {
    count: 250,
    seedStart: 900,
    chunkSize: 100,
    onProgress: (done, total) => calls.push([done, total]),
  });
  assert.deepEqual(calls, [
    [100, 250],
    [200, 250],
    [250, 250],
  ], '按 chunk 触发，末尾补齐');
  assert.equal(JSON.stringify(withCb), JSON.stringify(plain), '进度回调不改变统计（铁律①）');
});

test('T2.6 statsToCsv：header + meta 行 + 各分布段（手拼零依赖）', () => {
  const stats = runBatch(world, { count: 200 });
  const csv = statsToCsv(stats);
  const lines = csv.split('\n').filter((l) => l.length > 0);
  assert.equal(lines[0], 'section,key,value');
  assert.ok(lines.includes(`meta,count,${stats.count}`));
  assert.ok(lines.includes(`meta,world,${stats.worldName}`));
  assert.ok(lines.some((l) => l.startsWith('formDist,')));
  assert.ok(lines.some((l) => l.startsWith('deathCauseDist,')));
  assert.ok(csv.endsWith('\n'));
});
