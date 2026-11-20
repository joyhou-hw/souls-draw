import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLife, hashLife, currentWeight, candidateEvents } from './engine.ts';
import type { World } from './types.ts';

function toyWorld(): World {
  return {
    name: '测试世界',
    tickName: '年',
    startTick: 0,
    endTick: 60,
    initAttrs: { health: 100, spirit: 0, fame: 0 },
    events: [
      { id: 'quiet', label: '静默', weight: 8 },
      { id: 'study', label: '苦读', weight: 3, effects: { spirit: 5 } },
    ],
    deathRule: {
      bands: [{ fromTick: 0, hazard: 0.005 }],
      attrDeath: { attr: 'health', below: 1 },
    },
  };
}

function choiceWorld(): World {
  return {
    name: '抉择世界',
    tickName: '年',
    startTick: 0,
    endTick: 20,
    initAttrs: { health: 100, spirit: 0 },
    events: [
      {
        id: 'master',
        label: '遇师',
        weight: 1,
        cond: { minTick: 10, maxTick: 10 },
        gainFlags: ['met_master'],
        choice: {
        prompt: '拜师吗？',
        options: [
          { label: '拜师', effects: { spirit: 15 }, weightShifts: { training: 2 }, gainFlags: ['guild_ok'] },
          { label: '婉拒', effects: { spirit: 2 }, weightShifts: { training: 0.1 } },
        ],
      },
      },
      { id: 'training', label: '修行', weight: 4, cond: { flags: ['met_master'] }, effects: { spirit: 6 } },
    ],
    deathRule: {
      bands: [{ fromTick: 0, hazard: 0.0001 }],
    },
  };
}

test('铁律①：同 seed 两条人生逐字段一致（hashLife 相同）', () => {
  const w = toyWorld();
  const a = runLife(w, { seed: 987654 });
  const b = runLife(w, { seed: 987654 });
  assert.equal(hashLife(a), hashLife(b));
  assert.deepEqual(a.log, b.log);
  assert.deepEqual(a.state.attrs, b.state.attrs);
});

test('铁律①反例：不同 seed 产生不同人生', () => {
  const w = toyWorld();
  const a = hashLife(runLife(w, { seed: 1 }));
  const b = hashLife(runLife(w, { seed: 2 }));
  assert.notEqual(a, b);
});

test('T1.4 事件池权重统计：quiet:study ≈ 8:3（3000 条 × 4 掷骰，容差 ±10%）', () => {
  const w = toyWorld();
  w.endTick = 4;
  let quiet = 0;
  const lives = 3000;
  for (let i = 0; i < lives; i++) {
    const r = runLife(w, { seed: 100000 + i });
    quiet += r.log.filter((e) => e.eventId === 'quiet').length;
  }
  const expected = lives * 4 * (8 / 11);
  assert.ok(
    Math.abs(quiet - expected) / expected < 0.1,
    `quiet 总次数 ${quiet}，期望 ${expected.toFixed(0)}，偏差超 10%`,
  );
});

test('T1.5 choice 概率位移：拜师后 training 权重 ×2、婉拒 ×0.1（不写死分支）', () => {
  const w = choiceWorld();
  const masterEv = w.events.find((e) => e.id === 'master')!;

  const noShift = { tick: 20, alive: true, attrs: {}, flags: ['met_master'], shifts: {} };
  assert.equal(currentWeight(masterEv, noShift), 1, '无 shift 时基础权重为 1');

  const a = runLife(w, { seed: 555, resolveChoice: () => 0 });
  assert.ok(a.state.flags.includes('met_master'), '遇师事件必在 tick 10 触发');
  assert.equal(a.state.shifts['training'], 2, '拜师选项应将 training 权重乘以 2');
  assert.ok(a.state.attrs.spirit! >= 15, '拜师 effect 已生效');

  const b = runLife(w, { seed: 555, resolveChoice: () => 1 });
  assert.ok(Math.abs(b.state.shifts['training']! - 0.1) < 1e-9, '婉拒选项应将 training 权重乘以 0.1');

  const cands = candidateEvents(w, { ...noShift, shifts: { training: 0.1 } });
  assert.ok(
    cands.some((e) => e.id === 'training'),
    '婉拒后 training 仍在事件池——概率被压低，而非分支消失（公理②）',
  );
});

test('T1.6 death_check：构造高风险世界可触发死亡', () => {
  const brutal: World = {
    name: '残酷世界',
    tickName: '年',
    startTick: 0,
    endTick: 100,
    initAttrs: { health: 100 },
    events: [{ id: 'quiet', label: '静默', weight: 1 }],
    deathRule: {
      bands: [{ fromTick: 0, hazard: 0.9 }],
      attrDeath: { attr: 'health', below: 1 },
    },
  };
  let died = 0;
  for (let i = 0; i < 50; i++) {
    const r = runLife(brutal, { seed: 900000 + i });
    if (r.deathTick !== null) died++;
  }
  assert.ok(died >= 45, `50 条高危人生仅 ${died} 条死亡，death_check 疑似失效`);
});

test('T1.6 health 归零即死（attrDeath）', () => {
  const sick: World = {
    name: '病世界',
    tickName: '年',
    startTick: 0,
    endTick: 30,
    initAttrs: { health: 10 },
    events: [{ id: 'plague', label: '重疫', weight: 1, effects: { health: -20 } }],
    deathRule: {
      bands: [{ fromTick: 0, hazard: 0.0001 }],
      attrDeath: { attr: 'health', below: 1 },
    },
  };
  const r = runLife(sick, { seed: 3 });
  assert.equal(r.state.alive, false);
  assert.equal(r.deathCause, 'health');
  assert.equal(r.deathTick, 1);
});

test('T4.2 抉择暂停与重放同构：resolver 返回 -1 暂停，同 seed + 同抉择序列重放一致', () => {
  const w = choiceWorld();
  const pauseAt = (picked: number[]) => {
    let used = 0;
    return runLife(w, {
      seed: 42,
      resolveChoice: (_c, _s, _r) => (used < picked.length ? picked[used++]! : -1),
    });
  };
  const a = pauseAt([]);
  assert.equal(a.pausedChoice?.prompt, '拜师吗？');
  assert.ok(a.log.every((e) => e.tick < 10), '暂停时 log 截断在 choice 事件 tick 之前');
  assert.equal(a.state.alive, true, '暂停 ≠ 死亡');
  const b = pauseAt([0]);
  assert.equal(b.pausedChoice, undefined, '选完不再暂停');
  assert.ok(b.log.some((e) => e.choice?.prompt === '拜师吗？'), '选择已入 log');
  const replay = runLife(w, { seed: 42, resolveChoice: () => 0 });
  assert.equal(hashLife(b), hashLife(replay), '同 seed + 同抉择序列 → 同人生（重放同构）');
});

test('T4.2 选项级 gainFlags：flag 只归属于选中的选项，婉拒者不被误标记', () => {
  const w = choiceWorld();
  const accept = runLife(w, { seed: 42, resolveChoice: () => 0 });
  assert.ok(accept.state.flags.includes('guild_ok'), '选「拜师」获得 guild_ok');
  const decline = runLife(w, { seed: 42, resolveChoice: () => 1 });
  assert.ok(!decline.state.flags.includes('guild_ok'), '选「婉拒」不获得 guild_ok');
  assert.equal(hashLife(accept) === hashLife(decline), false, '两种选择产生不同人生');
});
