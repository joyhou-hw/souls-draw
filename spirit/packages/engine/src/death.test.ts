import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deathCheck, runLife, tierOf } from './engine.ts';
import type { PersonState, World } from './types.ts';
import type { Rng } from './rng.ts';

function deathWorld(extra: Partial<World>): World {
  return {
    name: '死亡测试世界',
    tickName: '年',
    startTick: 0,
    endTick: 6,
    initAttrs: { liquality: 100 },
    events: [],
    deathRule: { bands: [{ fromTick: 99, hazard: 0 }] },
    deathModel: 'liquality_balance',
    ...extra,
  };
}

function stubRng(next: number): Rng {
  const seed = 0;
  return {
    seed,
    next: () => next,
    int: (max) => Math.floor(next * max),
    pick: (items) => items[Math.floor(next * items.length)] as (typeof items)[number],
    weightedPick: (entries) => entries[entries.length - 1]!.item,
  };
}

function personOf(tick: number, form: string): PersonState {
  return {
    tick,
    alive: true,
    attrs: { health: 50, liquality: 50 },
    flags: [`form:${form}`],
    shifts: {},
    firedEvents: new Set(),
    cooldownUntil: {},
  };
}

test('T2.4 灵质收支表：余额 ≤ 0 → 灵质衰竭死亡', () => {
  const w = deathWorld({
    initAttrs: { liquality: 10 },
    events: [{ id: 'drain', label: '战斗损耗', weight: 1, effects: { liquality: -4 } }],
  });
  const r = runLife(w, { seed: 5 });
  assert.equal(r.deathCause, 'liquality_exhausted');
  assert.equal(r.deathTick, 3);
  assert.ok(r.state.attrs['liquality']! <= 0);
});

test('T2.4 灵质收支：充盈者不受衰竭判定，走 bands hazard', () => {
  const w = deathWorld({
    initAttrs: { liquality: 50 },
    events: [{ id: 'quiet', label: '静修', weight: 1, effects: { liquality: 1 } }],
  });
  const r = runLife(w, { seed: 5 });
  assert.equal(r.deathCause, '');
  assert.ok(r.state.attrs['liquality']! > 50);
});

test('T2.4 t2 空间系死亡绑定：失去空间系灵质（无双灵质）→ 死亡', () => {
  const w = deathWorld({
    hardThresholds: {
      t2SpaceDeathBound: { rule: 'space_loss_equals_death', exception: 'dual_essence' },
    },
    events: [
      { id: 'grant', label: '觉醒空间系', weight: 1, cond: { minTick: 1, maxTick: 1 }, gainFlags: ['lixi:space'] },
      { id: 'strip', label: '被夺灵', weight: 1, cond: { minTick: 3, maxTick: 3 }, lossFlags: ['lixi:space'] },
    ],
  });
  const r = runLife(w, { seed: 9 });
  assert.equal(r.deathCause, 'space_lixi_lost');
  assert.equal(r.deathTick, 3);
  assert.ok(!r.state.flags.includes('lixi:space'));
});

test('T2.4 t2 双灵质例外：dual_essence 失去灵系而幸存', () => {
  const w = deathWorld({
    hardThresholds: {
      t2SpaceDeathBound: { rule: 'space_loss_equals_death', exception: 'dual_essence' },
    },
    events: [
      {
        id: 'grant',
        label: '觉醒双灵质',
        weight: 1,
        cond: { minTick: 1, maxTick: 1 },
        gainFlags: ['lixi:space', 'dual_lix'],
      },
      { id: 'strip', label: '被夺空间系', weight: 1, cond: { minTick: 3, maxTick: 3 }, lossFlags: ['lixi:space'] },
    ],
  });
  const r = runLife(w, { seed: 9 });
  assert.equal(r.deathCause, '');
  assert.ok(r.state.flags.includes('dual_lix'));
  assert.ok(!r.state.flags.includes('lixi:space'));
  const stripEntry = r.log.find((e) => e.eventId === 'strip');
  assert.ok(stripEntry?.label.includes('双灵质例外'));
});

test('T2.4 t2 只绑定声明灵系：非空间系灵质被夺不死', () => {
  const w = deathWorld({
    hardThresholds: {
      t2SpaceDeathBound: { rule: 'space_loss_equals_death', exception: 'dual_essence' },
    },
    events: [
      { id: 'grant', label: '觉醒御灵系', weight: 1, cond: { minTick: 1, maxTick: 1 }, gainFlags: ['lixi:yuling'] },
      { id: 'strip', label: '御灵系被夺', weight: 1, cond: { minTick: 3, maxTick: 3 }, lossFlags: ['lixi:yuling'] },
    ],
  });
  const r = runLife(w, { seed: 9 });
  assert.equal(r.deathCause, '');
  assert.ok(!r.state.flags.includes('lixi:yuling'));
});

test('T2.4 数据驱动：未声明 t2 绑定的世界失去灵系不死', () => {
  const w = deathWorld({
    events: [
      { id: 'grant', label: '觉醒御灵', weight: 1, cond: { minTick: 1, maxTick: 1 }, gainFlags: ['lixi:御灵'] },
      { id: 'strip', label: '灵系受创', weight: 1, cond: { minTick: 3, maxTick: 3 }, lossFlags: ['lixi:御灵'] },
    ],
  });
  const r = runLife(w, { seed: 9 });
  assert.equal(r.deathCause, '');
  assert.ok(!r.state.flags.includes('lixi:御灵'));
});

test('T2.4 terminal 终点事件：触发即截断人生线', () => {
  const w = deathWorld({
    events: [
      {
        id: 'ascend',
        label: '飞升离陆',
        weight: 1,
        cond: { minTick: 2, maxTick: 2 },
        terminal: true,
        gainFlags: ['ascend'],
      },
    ],
  });
  const r = runLife(w, { seed: 3 });
  assert.equal(r.deathCause, 'terminal:ascend');
  assert.equal(r.deathTick, 2);
  assert.ok(r.state.flags.includes('ascend'));
});

test('T2.4 tierOf：取人物最新阶梯档', () => {
  const w = deathWorld({
    events: [
      { id: 'gate1', label: '凡体突破', weight: 1, cond: { minTick: 1, maxTick: 1 }, gainFlags: ['tier:fanti'] },
      { id: 'gate2', label: '凝形突破', weight: 1, cond: { minTick: 3, maxTick: 3 }, gainFlags: ['tier:ningxing'] },
    ],
  });
  const r = runLife(w, { seed: 7 });
  assert.equal(tierOf(r.state), 'ningxing');
  const noTier: PersonState = { tick: 0, alive: true, attrs: {}, flags: [], shifts: {}, firedEvents: new Set<string>(), cooldownUntil: {} };
  assert.equal(tierOf(noTier), undefined);
});

test('B 形态化寿命：形态专属 bands 完全覆盖全局危害曲线', () => {
  const w = deathWorld({
    deathRule: {
      bands: [{ fromTick: 40, hazard: 0.1 }],
      forms: { plant_yao: { bands: [{ fromTick: 40, hazard: 0.9 }] } },
    },
  });
  assert.equal(deathCheck(w, personOf(50, 'plant_yao'), stubRng(0.5)), 'hazard');
  assert.equal(deathCheck(w, personOf(50, 'human'), stubRng(0.5)), null);
});

test('B 形态化寿命：multiplier <1 降低 hazard（妖精寿长于人类）', () => {
  const w = deathWorld({
    deathRule: {
      bands: [{ fromTick: 40, hazard: 0.5 }],
      forms: { plant_yao: { multiplier: 0.4 }, animal_yao: { multiplier: 0.7 } },
    },
  });
  assert.equal(deathCheck(w, personOf(50, 'plant_yao'), stubRng(0.3)), null);
  assert.equal(deathCheck(w, personOf(50, 'animal_yao'), stubRng(0.3)), 'hazard');
});

test('B 形态化寿命：无匹配形态回退全局 bands 与 attrDeath', () => {
  const w = deathWorld({
    deathRule: {
      bands: [{ fromTick: 40, hazard: 0.5 }],
      attrDeath: { attr: 'health', below: 10 },
      forms: { plant_yao: { multiplier: 0.4 } },
    },
  });
  assert.equal(deathCheck(w, personOf(50, 'human'), stubRng(0.3)), 'hazard');
  const dying: PersonState = { ...personOf(50, 'human'), attrs: { health: 5, liquality: 50 } };
  assert.equal(deathCheck(w, dying, stubRng(0.0)), 'health');
});
