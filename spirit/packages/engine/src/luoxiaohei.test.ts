import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadWorldFile } from '../../dsl/src/load.ts';
import { runLife, hashLife, tierOf } from './engine.ts';
import { generateBirth } from './birth.ts';
import { createRng } from './rng.ts';

const worldPath = fileURLToPath(new URL('../../../worlds/luoxiaohei/world.yaml', import.meta.url));
const world = loadWorldFile(worldPath, { strict: 'luoxiaohei' });

test('T2.5 世界包加载：19 块全量 + 三事件池合并（source 标记）', () => {
  assert.equal(world.name, '罗小黑世界');
  assert.equal(world.deathModel, 'liquality_balance');
  const base = world.events.filter((e) => e.source === 'events').length;
  const scenes = world.events.filter((e) => e.source === 'scenes').length;
  const shocks = world.events.filter((e) => e.source === 'shocks').length;
  assert.equal(base, 37);
  assert.equal(scenes, 77);
  assert.equal(shocks, 4);
  assert.equal(world.events.length, base + scenes + shocks);
  assert.equal(world.spiritDensity?.landmarks.laojun_alchemy_site, 5);
  assert.equal(world.spiritDensity?.landmarks.city, 0.5);
  assert.equal(world.talent?.spaceLixi.acquired, false);
  assert.equal(world.powerLadder?.tiers.length, 7);
  assert.equal(world.powerLadder?.tierGates.ascend?.event, 'ascend_trigger');
  assert.deepEqual(world.cultivationGate?.entryEventAgeWindow, [8, 24]);
  assert.equal(world.hardThresholds?.t2SpaceDeathBound?.rule, 'space_loss_equals_death');
  assert.equal(world.preBirthChain?.jingling.fate.length, 4);
  assert.equal(world.birthForm?.niche.length, 5);
  assert.equal(world.presentation?.demoWeights, true);
  assert.equal(world.presentation?.realRatio, '1/20000');
});

test('T2.5 冒烟：单条人生跑通（出生注入 + 前置链并入 log + 死因非空）', () => {
  const r = runLife(world, { seed: 42 });
  assert.ok(r.birth);
  const birthEntry = r.log.find((e) => e.eventId === 'birth');
  assert.ok(birthEntry && birthEntry.tick === 0);
  assert.ok(r.state.flags.some((f) => f.startsWith('form:')));
  assert.ok(r.deathCause.length > 0);
  assert.ok(r.log.length > 5);
});

test('铁律①延伸：罗小黑世界同 seed 同人生', () => {
  const r1 = runLife(world, { seed: 42 });
  const r2 = runLife(world, { seed: 42 });
  assert.equal(hashLife(r1), hashLife(r2));
});

test('T2.5 DoD：抽样运行可见模板触发（scene_* 与 shock_*）', () => {
  const eventIds = new Set<string>();
  for (let s = 1; s <= 50; s++) {
    for (const e of runLife(world, { seed: s }).log) eventIds.add(e.eventId);
  }
  assert.ok(
    [...eventIds].some((id) => id.startsWith('scene_')),
    `50 条抽样中场景模板从未触发（实际事件：${[...eventIds].join(', ')}）`,
  );
  assert.ok(
    [...eventIds].some((id) => id.startsWith('shock_')),
    '50 条抽样中时代冲击波从未触发',
  );
});

test('T2.5 灵力阶梯：修行者人生可走上突破链（至少入门定档）', () => {
  let cultivatorSeed = -1;
  for (let s = 0; s < 2000; s++) {
    if (generateBirth(world, createRng(s)).cultivator) {
      cultivatorSeed = s;
      break;
    }
  }
  assert.ok(cultivatorSeed >= 0, '2000 个 seed 中未出现修行者（异常）');
  // 修行入门需 minTick:6，找一个能活过 6 岁的修行者 seed
  for (let s = cultivatorSeed; s < 2000; s++) {
    if (!generateBirth(world, createRng(s)).cultivator) continue;
    const r = runLife(world, { seed: s });
    if (r.state.tick < 7) continue; // 活不过 7 岁就换下一个
    if (r.log.some((e) => e.eventId === 'init_tier' || e.eventId.startsWith('gate_'))) {
      assert.ok(r.birth?.cultivator, 'runLife 出生与 generateBirth 探测不一致（rng 序列异常）');
      assert.notEqual(tierOf(r.state), undefined);
      return;
    }
  }
  assert.fail('2000 个 seed 中未找到能触发灵力阶梯的修行者');
});

test('T2.4/t2 链路：空间系灵质被夺 → 灵质空间衰竭死亡可复现', () => {
  const spaceSeeds: number[] = [];
  for (let s = 0; s < 20000 && spaceSeeds.length < 10; s++) {
    const b = generateBirth(world, createRng(s));
    if (b.lixi === 'space' && !b.dualLixi) spaceSeeds.push(s);
  }
  assert.ok(spaceSeeds.length >= 5, '抽样中空间系灵质过少（异常）');
  const rs = spaceSeeds.map((s) => runLife(world, { seed: s }));
  assert.ok(
    rs.every((r) => r.birth?.lixi === 'space'),
    'runLife 出生与 generateBirth 探测不一致（rng 序列异常）',
  );
  assert.ok(
    rs.some((r) => r.deathCause === 'space_lixi_lost'),
    '空间系灵质被夺的死亡链路未复现',
  );
});
