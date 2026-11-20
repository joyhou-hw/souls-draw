import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng.ts';
import { generateBirth, birthFlags } from './birth.ts';
import { buildSlotContext, renderText, NarrativeRenderer } from './narrative.ts';
import type { BirthOutcome, Narratives, PersonState, World } from './types.ts';

/** 构造测试用 World——birthForm 含 speciesVariety 品种池 */
function makeWorldWithVariety(): World {
  return {
    name: 'test_variety',
    tickName: '年',
    startTick: 0,
    endTick: 5,
    initAttrs: { liquality: 100, health: 80 },
    events: [{ id: 'quiet', label: '平静', weight: 1 }],
    deathRule: { bands: [{ fromTick: 0, hazard: 0 }] },
    birthAxes: {
      region: ['forest', 'city'],
      era: ['ancient'],
    },
    birthForm: {
      weights: { animal_yao: 1.0 },
      speciesPrototype: { animal_yao: ['cat', 'wolf'] },
      speciesVariety: {
        cat: ['orange_cat', 'black_cat', 'tabby_cat', 'calico'],
        wolf: ['snow_wolf', 'grey_wolf', 'black_wolf'],
      },
      niche: ['guild_servant'],
    },
    preBirthChain: {
      humanLine: 'human',
      shengling: { p: { forest: 1, city: 1 } },
      jingling: { fate: [] },
    },
  } as unknown as World;
}

/** 同结构但不带 speciesVariety 的 World——用于 render_only 对比 */
function makeWorldWithoutVariety(): World {
  const w = makeWorldWithVariety();
  (w.birthForm as { speciesVariety?: unknown }).speciesVariety = undefined;
  return w;
}

function makeBirth(over: Partial<BirthOutcome> = {}): BirthOutcome {
  return {
    form: 'animal_yao',
    species: 'cat',
    variety: 'orange_cat',
    niche: 'guild_servant',
    region: 'forest',
    era: 'ancient',
    dualLixi: false,
    reincarnatedSoul: false,
    liqiManifest: false,
    cultivator: false,
    preBirthLog: [],
    ...over,
  };
}

const baseSlots = {
  place: { forest: '森林' },
  era: { ancient: '古代' },
  species: { cat: '猫妖', wolf: '狼妖' },
  variety: {
    orange_cat: '橘猫',
    black_cat: '黑猫',
    tabby_cat: '狸花猫',
    calico: '三花猫',
    snow_wolf: '雪原狼',
    grey_wolf: '灰狼',
    black_wolf: '黑狼',
  },
  niche: { guild_servant: '会馆杂役' },
};

test('品种轴 variety 确定性——同 seed 同 variety', () => {
  const world = makeWorldWithVariety();
  const s = 12345;
  const b1 = generateBirth(world, createRng(s));
  const b2 = generateBirth(world, createRng(s));
  assert.equal(b1.variety, b2.variety, '同 seed 应产出相同 variety');
  // 同时验证 species/region 也一致（说明 rng 流未被破坏）
  assert.equal(b1.species, b2.species);
  assert.equal(b1.region, b2.region);
});

test('品种轴 variety 随 seed 变化——不同 seed 可能产出不同 variety', () => {
  const world = makeWorldWithVariety();
  const seen = new Set<string>();
  for (let s = 0; s < 200; s++) {
    const b = generateBirth(world, createRng(s));
    if (b.species === 'cat' && b.variety) seen.add(b.variety);
  }
  // cat 品种池 4 个，200 次应至少触发 3 个以上不同值
  assert.ok(seen.size >= 3, `200 次应至少见到 3 个不同猫品种，实际 ${seen.size}：${[...seen].join(',')}`);
});

test('品种轴 variety render_only——不进 birthFlags', () => {
  const b1 = makeBirth({ variety: 'orange_cat' });
  const b2 = makeBirth({ variety: 'black_cat' });
  const f1 = birthFlags(b1);
  const f2 = birthFlags(b2);
  assert.deepEqual(f1, f2, 'variety 不应进 birthFlags（桶匹配零影响）');
  // 确认 birthFlags 中无 variety 字样
  assert.ok(!f1.some((f) => f.includes('variety')), 'birthFlags 不应包含 variety');
});

test('品种轴 variety render_only——有/无 speciesVariety 事件流完全一致', () => {
  const narr: Narratives = {
    version: 1,
    slots: baseSlots,
    events: {
      quiet: {
        fallback: [{ id: 'qy_f_01', text: '寻常一年。' }],
        buckets: [
          { when: { form: 'animal_yao' }, variants: [{ id: 'qy_a_01', text: '妖精的一年。' }] },
        ],
      },
    },
  };
  const worldWith = makeWorldWithVariety();
  const worldWithout = makeWorldWithoutVariety();
  (worldWith as { narratives: Narratives }).narratives = narr;
  (worldWithout as { narratives: Narratives }).narratives = narr;

  // 用相同 seed 生成出生（有/无 variety 的世界，rng 流应一致——因 pickVariety 在 species 之后调用，
  // 但若 variety 块缺失 pickVariety 直接 return undefined，不消耗 rng.pick。
  // 为严格对比，用固定 birth + 固定 rng 渲染事件，确保事件流完全一致）
  const birth = makeBirth({ variety: 'orange_cat' });
  const r1 = new NarrativeRenderer(worldWith, birth);
  const r2 = new NarrativeRenderer(worldWithout, { ...birth, variety: undefined });

  // 100 次渲染，输出应完全一致（桶匹配依据 form/species，与 variety 无关）
  for (let i = 0; i < 100; i++) {
    const state: PersonState = { tick: 1, alive: true, attrs: {}, flags: [], shifts: {}, firedEvents: new Set<string>(), cooldownUntil: {} };
    const out1 = r1.renderEvent('quiet', state, createRng(i))!;
    const out2 = r2.renderEvent('quiet', state, createRng(i))!;
    assert.equal(out1, out2, `iteration ${i}: variety 有/无应不影响事件输出`);
  }
});

test('品种轴 variety 槽位呈现——{variety} 替换为中文', () => {
  const text = '一只{variety}{species}在{place}出没。';
  const ctx = buildSlotContext(makeBirth({ variety: 'orange_cat' }))!;
  const out = renderText(text, ctx, baseSlots);
  assert.equal(out, '一只橘猫猫妖在森林出没。');
});

test('品种轴 variety 槽位缺省——slots 无 variety 块时回退原始枚举值', () => {
  const text = '一只{variety}走过。';
  const ctx = buildSlotContext(makeBirth({ variety: 'moonveil' }))!;
  const slotsNoVariety = {
    place: { forest: '森林' },
    era: { ancient: '古代' },
    species: { cat: '猫妖' },
    niche: { guild_servant: '会馆杂役' },
  };
  const out = renderText(text, ctx, slotsNoVariety);
  assert.equal(out, '一只moonveil走过。');
});

test('品种轴 variety 缺省——species 无品种池时 variety 为 undefined', () => {
  const world = makeWorldWithVariety();
  // paper_creature 在 speciesPrototype 但 speciesVariety 无对应池
  (world.birthForm as { speciesPrototype: Record<string, string[]> }).speciesPrototype = {
    animal_yao: ['paper_creature'],
  };
  const b = generateBirth(world, createRng(1));
  assert.equal(b.species, 'paper_creature');
  assert.equal(b.variety, undefined, '无品种池的 species，variety 应为 undefined');
});

test('品种轴 variety 出生 label——含 species+variety', () => {
  const world = makeWorldWithVariety();
  // 多次跑直到拿到带 variety 的出生
  let found = false;
  for (let s = 0; s < 100; s++) {
    const b = generateBirth(world, createRng(s));
    if (b.variety) {
      const birthLog = b.preBirthLog.find((e) => e.eventId === 'birth');
      assert.ok(birthLog, '应有 birth 日志');
      assert.ok(birthLog!.label.includes(b.variety!), `出生 label 应含 variety: ${birthLog!.label}`);
      found = true;
      break;
    }
  }
  assert.ok(found, '100 次内应至少一次出生带 variety');
});

test('品种轴 variety 凝形 label——含 species+variety', () => {
  const world = makeWorldWithVariety();
  let found = false;
  for (let s = 0; s < 100; s++) {
    const b = generateBirth(world, createRng(s));
    if (b.variety) {
      const condenseLog = b.preBirthLog.find((e) => e.eventId === 'pre_birth/condense');
      assert.ok(condenseLog, '应有凝形日志');
      assert.ok(condenseLog!.label.includes(b.variety!), `凝形 label 应含 variety: ${condenseLog!.label}`);
      found = true;
      break;
    }
  }
  assert.ok(found, '100 次内应至少一次凝形带 variety');
});
