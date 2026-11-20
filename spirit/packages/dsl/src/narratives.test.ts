import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileWorldText } from './compile.ts';
import { validateNarratives, NarrativesValidateError } from './narratives.ts';
import { loadWorldPack } from './load.ts';

const baseWorldYaml = [
  'name: 玩具世界',
  'tickName: 年',
  'startTick: 0',
  'endTick: 80',
  'initAttrs: {health: 100}',
  'events:',
  '  - {id: quiet, label: 静默, weight: 8}',
  'deathRule:',
  '  bands: [{fromTick: 0, hazard: 0.01}]',
].join('\n');

test('T3.1 合法 narratives 通过：事件变体 + 碎片 + 桶就位', () => {
  const narr = [
    'version: 1',
    'openers:',
    '  - id: op_01',
    '    text: 雨季来得早，',
    'events:',
    '  quiet:',
    '    fallback:',
    '      - id: qy_f_01',
    '        text: 平静的一年，{place}无风也无浪。',
    '    buckets:',
    '      - when: {form: human}',
    '        variants:',
    '          - id: qy_h_01',
    '            text: 凡人的寻常一年。',
  ].join('\n');
  const w = compileWorldText(baseWorldYaml, '<t>', {}, narr);
  assert.ok(w.narratives);
  assert.equal(w.narratives.openers?.length, 1);
  assert.equal(w.narratives.events?.['quiet']?.fallback?.length, 1);
  assert.equal(w.narratives.events?.['quiet']?.buckets?.[0]?.when?.form, 'human');
});

test('T3.1 未知事件 id 被拒（防生成漂移）', () => {
  const narr = ['version: 1', 'events:', '  no_such_event:', '    fallback:', '      - {id: x_01, text: 一句。}'].join('\n');
  assert.throws(
    () => compileWorldText(baseWorldYaml, '<t>', {}, narr),
    (e: unknown) => {
      assert.ok(e instanceof NarrativesValidateError);
      assert.match(e.message, /no_such_event/);
      return true;
    },
  );
});

test('T3.1 变体 id 全局重复被拒（不放回抽样键唯一）', () => {
  const narr = [
    'version: 1',
    'events:',
    '  quiet:',
    '    fallback:',
    '      - {id: qy_f_01, text: 甲。}',
    '      - {id: qy_f_01, text: 乙。}',
  ].join('\n');
  assert.throws(() => compileWorldText(baseWorldYaml, '<t>', {}, narr), /重复.*qy_f_01/);
});

test('T3.1 未知槽位与未配对花括号被拒', () => {
  const badSlot = ['version: 1', 'events:', '  quiet:', '    fallback:', '      - id: qy_f_01', '        text: 你在{foo}过了一年。'].join('\n');
  assert.throws(() => compileWorldText(baseWorldYaml, '<t>', {}, badSlot), /未知槽位.*\{foo\}/);
  const unbalanced = ['version: 1', 'events:', '  quiet:', '    fallback:', '      - id: qy_f_02', '        text: 一年就这么{过。'].join('\n');
  assert.throws(() => compileWorldText(baseWorldYaml, '<t>', {}, unbalanced), /花括号必须成对/);
});

test('T3.1 条件桶枚举值与出生轴交叉校验', () => {
  const axesYaml = baseWorldYaml.replace(
    'deathRule:',
    ['birthAxes:', '  region: [forest, city]', '  era: [modern]', 'deathRule:'].join('\n'),
  );
  const badRegion = [
    'version: 1',
    'events:',
    '  quiet:',
    '    buckets:',
    '      - when: {region: volcano}',
    '        variants:',
    '          - {id: qy_r_01, text: 火山口的一年。}',
  ].join('\n');
  assert.throws(() => compileWorldText(axesYaml, '<t>', {}, badRegion), /when\.region.*volcano/);
});

test('T3.1 未声明的里程碑题注被拒（须 narrativeFeed 声明在前）', () => {
  const feedYaml = baseWorldYaml.replace(
    'deathRule:',
    ['narrativeFeed:', '  rule: render_only', '  trigger: milestone_events', '  milestones: [first_transform]', 'deathRule:'].join('\n'),
  );
  const ok = [
    'version: 1',
    'milestones:',
    '  first_transform:',
    '    - {id: ms_ft_01, text: 化形那夜的你。}',
  ].join('\n');
  const w = compileWorldText(feedYaml, '<t>', {}, ok);
  assert.equal(w.narratives?.milestones?.['first_transform']?.length, 1);
  assert.throws(() => compileWorldText(feedYaml, '<t>', {}, ok.replace('first_transform:', 'undeclared:')), /undeclared/);
  assert.throws(() => compileWorldText(baseWorldYaml, '<t>', {}, ok), /未声明 narrativeFeed\.milestones/);
});

test('T3.1 空 narratives（仅 version）被拒', () => {
  assert.throws(() => compileWorldText(baseWorldYaml, '<t>', {}, 'version: 1'), /不能为空/);
});

test('T3.1 罗小黑真实包：打样种子库过闸（loadWorldPack 双文件加载）', () => {
  const w = loadWorldPack('worlds/luoxiaohei', { strict: 'luoxiaohei' });
  assert.ok(w.narratives, '打样 narratives.yaml 加载并校验通过');
  const variantCount = countVariants(w.narratives);
  assert.ok(variantCount >= 30, `打样至少 30 条变体（实际 ${variantCount}）`);
  assert.ok(w.narratives.events?.['quiet_year']?.buckets?.[0]?.when?.form === 'human');
  assert.equal(w.narratives.milestones?.['scene_first_transform']?.length, 15);
});

function countVariants(n: NonNullable<ReturnType<typeof compileWorldText>['narratives']>): number {
  let count = 0;
  count += n.openers?.length ?? 0;
  count += n.closers?.length ?? 0;
  for (const cfg of Object.values(n.events ?? {})) {
    count += cfg.fallback?.length ?? 0;
    for (const b of cfg.buckets ?? []) count += b.variants.length;
  }
  for (const list of Object.values(n.milestones ?? {})) count += list.length;
  return count;
}
