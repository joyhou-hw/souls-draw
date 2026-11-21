import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng.ts';
import { NarrativeRenderer, buildSlotContext, renderLifeLog, renderText } from './narrative.ts';
import type { BirthOutcome, LifeResult, Narratives, PersonState, World } from './types.ts';

function makeBirth(over: Partial<BirthOutcome> = {}): BirthOutcome {
  return {
    form: 'animal_yao',
    species: 'cat',
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

function makeWorld(narr: Narratives): World {
  return {
    name: 'test',
    tickName: '年',
    startTick: 0,
    endTick: 5,
    initAttrs: { liquality: 100, health: 80 },
    events: [
      { id: 'quiet', label: '平静', weight: 1 },
      { id: 'choice_evt', label: '抉择', weight: 1, choice: { prompt: '选吗？', options: [{ label: '是' }, { label: '否' }] } },
    ],
    deathRule: { bands: [{ fromTick: 0, hazard: 0 }] },
    narratives: narr,
  } as unknown as World;
}

function makeState(tick = 1): PersonState {
  return { tick, alive: true, attrs: {}, flags: [], shifts: {}, grainShifts: {}, firedEvents: new Set<string>(), cooldownUntil: {} };
}

const baseSlots = {
  place: { forest: '森林', city: '城市' },
  era: { ancient: '古代', modern: '现代' },
  species: { cat: '猫妖', human: '人类' },
  niche: { guild_servant: '会馆杂役' },
};

test('T3.2 槽位模板替换——{place}/{species}/{era} 替换为中文呈现', () => {
  const text = '你在{place}度过{era}的一年，{species}的身份无人知晓。';
  const ctx = buildSlotContext(makeBirth())!;
  const out = renderText(text, ctx, baseSlots);
  assert.equal(out, '你在森林度过古代的一年，猫妖的身份无人知晓。');
});

test('T3.2 槽位缺省映射——slots 无对应键时回退原始枚举值', () => {
  const text = '你去了{place}。';
  const ctx = buildSlotContext(makeBirth({ region: 'unknown_land' }))!;
  const out = renderText(text, ctx, baseSlots);
  assert.equal(out, '你去了unknown_land。');
});

test('T3.2 碎片拼接——opener + 事件句 + closer', () => {
  const narr: Narratives = {
    version: 1,
    slots: baseSlots,
    openers: [{ id: 'op_01', text: '这一年{place}的雨季来得早，' }],
    closers: [{ id: 'cl_01', text: '你把这一年收进心里。' }],
    events: {
      quiet: {
        fallback: [{ id: 'qy_f_01', text: '平静的一年，无风也无浪。' }],
      },
    },
  };
  const world = makeWorld(narr);
  const birth = makeBirth();
  const renderer = new NarrativeRenderer(world, birth);
  const rng = createRng(42);
  // 多次渲染确保碎片拼接至少有时出现
  let gotOpener = false;
  let gotCloser = false;
  for (let i = 0; i < 100; i++) {
    const state = makeState();
    const out = renderer.renderEvent('quiet', state, createRng(i))!;
    if (out.includes('雨季来得早')) gotOpener = true;
    if (out.includes('收进心里')) gotCloser = true;
  }
  assert.ok(gotOpener, '100 次内应至少出现一次 opener');
  assert.ok(gotCloser, '100 次内应至少出现一次 closer');
});

test('T3.3 条件桶——form=human 匹配 human 桶', () => {
  const narr: Narratives = {
    version: 1,
    slots: baseSlots,
    events: {
      quiet: {
        fallback: [{ id: 'qy_f_01', text: '兜底变体。' }],
        buckets: [
          {
            when: { form: 'human' },
            variants: [{ id: 'qy_h_01', text: '凡人的寻常一年。' }],
          },
          {
            when: { form: 'animal_yao' },
            variants: [{ id: 'qy_ay_01', text: '妖精的寻常一年。' }],
          },
        ],
      },
    },
  };
  const world = makeWorld(narr);
  // human 出生 → 匹配 human 桶
  const humanBirth = makeBirth({ form: 'human', species: undefined });
  const renderer = new NarrativeRenderer(world, humanBirth);
  const state = makeState();
  const out = renderer.renderEvent('quiet', state, createRng(1))!;
  assert.ok(out.includes('凡人'), `human 桶应匹配，got: ${out}`);
  // animal_yao 出生 → 匹配 animal_yao 桶
  const yaoBirth = makeBirth({ form: 'animal_yao', species: 'cat' });
  const renderer2 = new NarrativeRenderer(world, yaoBirth);
  const out2 = renderer2.renderEvent('quiet', state, createRng(1))!;
  assert.ok(out2.includes('妖精'), `animal_yao 桶应匹配，got: ${out2}`);
});

test('T3.3 条件桶——无匹配时回退 fallback', () => {
  const narr: Narratives = {
    version: 1,
    slots: baseSlots,
    events: {
      quiet: {
        fallback: [{ id: 'qy_f_01', text: '兜底变体。' }],
        buckets: [
          {
            when: { form: 'spirit_yao' },
            variants: [{ id: 'qy_sy_01', text: '灵体的寻常一年。' }],
          },
        ],
      },
    },
  };
  const world = makeWorld(narr);
  const birth = makeBirth({ form: 'human', species: undefined });
  const renderer = new NarrativeRenderer(world, birth);
  const state = makeState();
  const out = renderer.renderEvent('quiet', state, createRng(1))!;
  assert.ok(out.includes('兜底'), `无桶匹配应回退 fallback，got: ${out}`);
});

test('T3.3 不放回抽样——同桶变体不重复出现', () => {
  const variants = Array.from({ length: 10 }, (_, i) => ({
    id: `qy_f_${String(i + 1).padStart(2, '0')}`,
    text: `变体${i + 1}。`,
  }));
  const narr: Narratives = {
    version: 1,
    slots: baseSlots,
    events: { quiet: { fallback: variants } },
  };
  const world = makeWorld(narr);
  const birth = makeBirth();
  const renderer = new NarrativeRenderer(world, birth);
  const seen = new Set<string>();
  for (let i = 0; i < 10; i++) {
    const state = makeState();
    const out = renderer.renderEvent('quiet', state, createRng(i))!;
    // 提取变体编号
    const m = out.match(/变体(\d+)/);
    assert.ok(m, `应匹配到变体编号: ${out}`);
    const num = m[1]!;
    assert.ok(!seen.has(num), `变体${num}不应重复出现`);
    seen.add(num);
  }
  assert.equal(seen.size, 10, '10 次渲染应产生 10 个不同变体');
});

test('T3.3 不放回抽样——桶抽空后回退全池复用', () => {
  const narr: Narratives = {
    version: 1,
    slots: baseSlots,
    events: {
      quiet: {
        fallback: [{ id: 'qy_f_01', text: '唯一变体。' }],
      },
    },
  };
  const world = makeWorld(narr);
  const birth = makeBirth();
  const renderer = new NarrativeRenderer(world, birth);
  const state = makeState();
  // 第一次消耗变体
  const out1 = renderer.renderEvent('quiet', state, createRng(1))!;
  assert.ok(out1.includes('唯一变体'));
  // 第二次——池已空，应回退复用
  const out2 = renderer.renderEvent('quiet', state, createRng(2))!;
  assert.ok(out2.includes('唯一变体'), '抽空后应回退复用');
});

test('T3.2 抉择 prompt 渲染——单条提示语，不走不放回抽样', () => {
  const narr: Narratives = {
    version: 1,
    slots: baseSlots,
    events: {
      choice_evt: {
        prompt: '会馆名册翻到你这一页，墨迹未干。{place}的会馆向你伸出橄榄枝。加入会馆吗？',
        fallback: [{ id: 'ce_f_01', text: '兜底。' }],
      },
    },
  };
  const world = makeWorld(narr);
  const birth = makeBirth();
  const renderer = new NarrativeRenderer(world, birth);
  const state = makeState();
  const prompt = renderer.renderPrompt('choice_evt', state)!;
  assert.ok(prompt.includes('森林'), `prompt 槽位应替换: ${prompt}`);
  assert.ok(prompt.includes('加入会馆吗'));
  // 连续调用应返回相同结果（不走不放回抽样）
  const prompt2 = renderer.renderPrompt('choice_evt', state)!;
  assert.equal(prompt, prompt2);
});

test('T3.2 无 narratives 配置时安全降级——返回 undefined', () => {
  const world = makeWorld({ version: 1 });
  const birth = makeBirth();
  const renderer = new NarrativeRenderer(world, birth);
  const state = makeState();
  assert.equal(renderer.renderEvent('quiet', state, createRng(1)), undefined);
  assert.equal(renderer.renderPrompt('choice_evt', state), undefined);
});

function makeLifeResult(world: World, over: Partial<LifeResult> = {}): LifeResult {
  return {
    world: world.name,
    seed: 42,
    state: makeState(3),
    log: [
      { tick: 1, eventId: 'quiet', label: '平静' },
      { tick: 2, eventId: 'choice_evt', label: '抉择', choice: { prompt: '选吗？', picked: '是' } },
      { tick: 3, eventId: 'breakthrough', label: '突破' },
    ],
    deathTick: null,
    deathCause: 'alive_end',
    birth: makeBirth(),
    ...over,
  };
}

function makeRenderWorld(): World {
  const narr: Narratives = {
    version: 1,
    slots: baseSlots,
    openers: [{ id: 'op_01', text: '{place}的雨季，' }],
    closers: [{ id: 'cl_01', text: '这一年就这么过去了。' }],
    events: {
      quiet: { fallback: [{ id: 'qy_f_01', text: '你在{place}过了平静的一年。' }] },
      choice_evt: { prompt: '{place}的岔路口，往哪边走？' },
      breakthrough: { fallback: [{ id: 'bt_f_01', text: '修为有一次小小的跃升。' }] },
    },
    milestones: { breakthrough: [{ id: 'bt_m_01', text: '第一次触到{niche}的门槛。' }] },
  };
  const world = makeWorld(narr);
  world.narrativeFeed = { rule: 'test', trigger: 'test', milestones: ['breakthrough'] };
  return world;
}

test('renderLifeLog 确定性——同 seed 重复渲染逐字一致', () => {
  const world = makeRenderWorld();
  const result = makeLifeResult(world);
  assert.deepEqual(renderLifeLog(world, result), renderLifeLog(world, result));
});

test('renderLifeLog 铁律 render_only——不回写人生结果', () => {
  const world = makeRenderWorld();
  const result = makeLifeResult(world);
  const before = JSON.stringify(result);
  renderLifeLog(world, result);
  assert.equal(JSON.stringify(result), before, '渲染不得改动 LifeResult');
});

test('renderLifeLog 优先级——prompt > 事件叙事 > 原始 label', () => {
  const world = makeRenderWorld();
  const lines = renderLifeLog(world, makeLifeResult(world));
  assert.equal(lines.length, 3);
  // 普通事件：走叙事库
  assert.ok(lines[0]!.text.includes('森林'), `应渲染槽位，got: ${lines[0]!.text}`);
  assert.equal(lines[0]!.isPrompt, false);
  // 抉择事件：prompt 优先
  assert.equal(lines[1]!.isPrompt, true);
  assert.ok(lines[1]!.text.includes('岔路口'), `prompt 优先，got: ${lines[1]!.text}`);
  assert.equal(lines[1]!.picked, '是');
  // 普通事件无题注
  assert.equal(lines[0]!.caption, undefined);
});

test('renderLifeLog 里程碑——命中 narrativeFeed.milestones 时带题注', () => {
  const world = makeRenderWorld();
  const lines = renderLifeLog(world, makeLifeResult(world));
  const bt = lines[2]!;
  assert.ok(bt.caption, '里程碑事件应有题注');
  assert.ok(bt.caption!.includes('会馆杂役'), `题注槽位应替换，got: ${bt.caption}`);
  assert.ok(bt.text.includes('跃升'), '主文本仍保留事件叙事');
});

test('renderLifeLog 降级——无 narratives 时回退原始 label', () => {
  const world = makeWorld({ version: 1 });
  const lines = renderLifeLog(world, makeLifeResult(world));
  assert.deepEqual(lines.map((l) => l.text), ['平静', '抉择', '突破']);
  assert.deepEqual(lines.map((l) => l.isPrompt), [false, false, false]);
  assert.ok(lines.every((l) => l.caption === undefined));
});
