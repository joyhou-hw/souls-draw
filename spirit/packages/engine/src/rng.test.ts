import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng.ts';

test('mulberry32 黄金向量：seed=12345 前 6 个 next() 输出与记录值逐位一致', () => {
  const rng = createRng(12345);
  const expected = [
    0.9797282678, 0.3067522645, 0.4842054215,
    0.8179344125, 0.5094283693, 0.3474718605,
  ];
  for (const v of expected) {
    const got = rng.next();
    assert.ok(Math.abs(got - v) < 1e-9, `输出偏离黄金向量：${got} vs ${v}`);
  }
});

test('同 seed 两个实例序列完全一致（铁律①：同 seed 同人生）', () => {
  const a = createRng(20261118);
  const b = createRng(20261118);
  for (let i = 0; i < 1000; i++) {
    assert.equal(a.next(), b.next());
  }
});

test('不同 seed 序列不同', () => {
  const a = createRng(1);
  const b = createRng(2);
  const sa = Array.from({ length: 8 }, () => a.next());
  const sb = Array.from({ length: 8 }, () => b.next());
  assert.notDeepEqual(sa, sb);
});

test('weightedPick 频率近似权重比（2:8，2000 次，容差 ±20%）', () => {
  const rng = createRng(42);
  let heavy = 0;
  const n = 2000;
  for (let i = 0; i < n; i++) {
    const pick = rng.weightedPick([
      { item: 'heavy', weight: 8 },
      { item: 'light', weight: 2 },
    ]);
    if (pick === 'heavy') heavy++;
  }
  const ratio = heavy / n;
  assert.ok(ratio > 0.64 && ratio < 0.96, `heavy 占比 ${ratio.toFixed(3)} 超出 [0.64, 0.96] 容差`);
});

test('weightedPick 对总权重为零/负抛可读错误', () => {
  const rng = createRng(7);
  assert.throws(() => rng.weightedPick([{ item: 'x', weight: 0 }]), /总权重必须为正/);
  assert.throws(() => rng.pick([]), /空数组/);
});
