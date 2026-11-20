import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBirth, birthFlags, resolveShenglingP } from './birth.ts';
import { runLife, hashLife } from './engine.ts';
import { createRng } from './rng.ts';
import type { World } from './types.ts';

const FORM_WEIGHTS: Record<string, number> = {
  human: 0.35,
  animal_yao: 0.30,
  plant_yao: 0.15,
  fungus_yao: 0.05,
  spirit_yao: 0.10,
  painted_yao: 0.05,
};

const LIXI_WEIGHTS: Record<string, number> = {
  御灵: 0.55,
  生灵: 0.20,
  锁御: 0.10,
  心灵: 0.07,
  造物: 0.07,
  空间: 0.01,
};

function birthWorld(landmarks: Record<string, number> = {}): World {
  return {
    name: '出生测试世界',
    tickName: '年',
    startTick: 0,
    endTick: 5,
    initAttrs: { health: 100 },
    events: [{ id: 'quiet', label: '静默', weight: 1 }],
    deathRule: { bands: [{ fromTick: 99, hazard: 0 }] },
    preBirthChain: {
      stages: ['shengling', 'jingling', 'condense', 'birth'],
      shengling: { p: { forest: 0.5 } },
      jingling: { fate: ['漂泊', '灵偶化', '被吸附', '自然凝形'] },
      condense: { prototype: ['animal', 'plant'] },
      rareLine: { reincarnatedSoulP: 0.001 },
      humanLine: 'human',
    },
    birthForm: {
      weights: FORM_WEIGHTS,
      speciesPrototype: { animal_yao: ['猫', '狼'], plant_yao: ['花', '草'] },
      niche: ['村头妖', '会馆杂役'],
    },
    birthAxes: { region: ['forest'], era: ['现代'] },
    cultivationGate: {
      step1LiqiManifestP: 0.25,
      step2EntryEventP: 0.15,
      entryEventAgeWindow: [8, 24],
    },
    talent: {
      lixi: LIXI_WEIGHTS,
      dualLiqualityP: 0.001,
      spaceLixi: { acquired: false },
    },
    spiritDensity: { landmarks, effect: 'shengling.p 环境加成' },
  };
}

function smoothRate(world: World, count: number): { smooth: number; total: number } {
  let smooth = 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const o = generateBirth(world, createRng(i * 613 + 17));
    const entry = o.preBirthLog.find((e) => e.eventId === 'pre_birth/shengling');
    if (entry) {
      total++;
      if (entry.label.includes('顺遂')) smooth++;
    }
  }
  return { smooth, total };
}

test('铁律①延伸：同 seed 出生链逐字段一致', () => {
  const w = birthWorld({ forest: 2.0 });
  const a = generateBirth(w, createRng(42));
  const b = generateBirth(w, createRng(42));
  assert.deepEqual(a, b);
  const ra = runLife(w, { seed: 42 });
  const rb = runLife(w, { seed: 42 });
  assert.equal(hashLife(ra), hashLife(rb));
  assert.deepEqual(ra.birth, rb.birth);
});

test('1,000 条抽样：形态分布 ≈ 权重表（±0.05）', () => {
  const w = birthWorld();
  const formDist: Record<string, number> = {};
  for (let i = 0; i < 1000; i++) {
    const o = generateBirth(w, createRng(i));
    formDist[o.form] = (formDist[o.form] ?? 0) + 1;
  }
  for (const [form, weight] of Object.entries(FORM_WEIGHTS)) {
    const actual = (formDist[form] ?? 0) / 1000;
    assert.ok(
      Math.abs(actual - weight) < 0.05,
      `form=${form} 期望 ${weight} 实际 ${actual}`,
    );
  }
});

test('1,000 条抽样：灵系分布 ≈ talent 权重（显性者内 ±0.05）', () => {
  const w = birthWorld();
  const lixiDist: Record<string, number> = {};
  let manifest = 0;
  for (let i = 0; i < 1000; i++) {
    const o = generateBirth(w, createRng(i * 7919 + 13));
    if (o.lixi) {
      manifest++;
      lixiDist[o.lixi] = (lixiDist[o.lixi] ?? 0) + 1;
    }
  }
  assert.ok(manifest > 100, `显性样本过少：${manifest}`);
  for (const [lixi, weight] of Object.entries(LIXI_WEIGHTS)) {
    const actual = (lixiDist[lixi] ?? 0) / manifest;
    assert.ok(
      Math.abs(actual - weight) < 0.05,
      `lixi=${lixi} 期望 ${weight} 实际 ${actual}`,
    );
  }
});

test('双闸：修行者率 ≈ p1×p2，且 cultivator ⊆ liqiManifest', () => {
  const w = birthWorld();
  let cultivators = 0;
  for (let i = 0; i < 2000; i++) {
    const o = generateBirth(w, createRng(i * 31 + 7));
    if (o.cultivator) {
      cultivators++;
      assert.ok(o.liqiManifest, '修行者必须已过闸1（灵力显性）');
    }
    if (o.cultivator && !o.lixi) assert.fail('修行者必须有灵系');
  }
  const actual = cultivators / 2000;
  assert.ok(
    Math.abs(actual - 0.0375) < 0.015,
    `修行者率期望 0.0375 实际 ${actual}`,
  );
});

test('灵气加成：resolveShenglingP 精确值 + 高灵气区顺遂率显著更高', () => {
  const high = birthWorld({ forest: 5.0 });
  const low = birthWorld({ forest: 0.0 });
  assert.equal(resolveShenglingP(high, 'forest'), 1.0);
  assert.equal(resolveShenglingP(low, 'forest'), 0.5);
  const h = smoothRate(high, 1000);
  const l = smoothRate(low, 1000);
  assert.ok(h.total > 500 && l.total > 500, `妖类样本不足：${h.total}/${l.total}`);
  assert.ok(
    h.smooth / h.total > l.smooth / l.total + 0.2,
    `高灵气顺遂率(${h.smooth}/${h.total}) 未显著高于低灵气(${l.smooth}/${l.total})`,
  );
});

test('转世魂灵稀有：3,000 条中占比 < 1%（名义 p=0.001）', () => {
  const w = birthWorld();
  let count = 0;
  for (let i = 0; i < 3000; i++) {
    if (generateBirth(w, createRng(i * 101 + 3)).reincarnatedSoul) count++;
  }
  assert.ok(count < 30, `转世数超预期：${count}`);
});

test('无 birthForm 世界：birth 为 undefined（toy 世界兼容）', () => {
  const w: World = {
    name: '最小世界',
    tickName: '年',
    startTick: 0,
    endTick: 3,
    initAttrs: { health: 100 },
    events: [{ id: 'quiet', label: '静默', weight: 1 }],
    deathRule: { bands: [{ fromTick: 99, hazard: 0 }] },
  };
  const r = runLife(w, { seed: 1 });
  assert.equal(r.birth, undefined);
});

test('runLife 集成：出生 flags 注入 + 前置链并入 log', () => {
  const w = birthWorld({ forest: 2.0 });
  const r = runLife(w, { seed: 100 });
  const b = r.birth!;
  assert.ok(b, '出生链未生成');
  assert.ok(r.state.flags.includes(`form:${b.form}`));
  assert.ok(r.state.flags.includes('region:forest'));
  assert.ok(r.state.flags.includes('era:现代'));
  if (b.form === 'human') {
    assert.equal(r.log[0]?.eventId, 'pre_birth/human_line');
  } else {
    assert.equal(r.log[0]?.eventId, 'pre_birth/shengling');
    assert.ok(
      r.state.flags.includes('niche:村头妖') || r.state.flags.includes('niche:会馆杂役'),
    );
    if (b.species) {
      assert.ok(r.state.flags.includes(`species:${b.species}`));
    }
  }
  const birthEntry = r.log.find((e) => e.eventId === 'birth')!;
  assert.equal(birthEntry.tick, 0);
  assert.equal(birthEntry.eventId, 'birth');
  const flags = birthFlags(b);
  assert.ok(flags.includes(`form:${b.form}`));
  assert.ok(flags.includes(`region:${b.region}`));
  if (b.cultivator) {
    assert.ok(flags.includes('cultivator'));
    assert.ok(flags.includes(`lixi:${b.lixi}`));
  }
});
