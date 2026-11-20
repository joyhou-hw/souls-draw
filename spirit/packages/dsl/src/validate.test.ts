import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWorld, WorldValidateError } from './validate.ts';
import { compileWorldText } from './compile.ts';

const validWorld = {
  name: '玩具世界',
  tickName: '年',
  startTick: 0,
  endTick: 80,
  initAttrs: { health: 100 },
  events: [{ id: 'quiet', label: '静默', weight: 8 }],
  deathRule: { bands: [{ fromTick: 0, hazard: 0.01 }] },
};

test('合法世界通过校验', () => {
  const w = validateWorld(validWorld);
  assert.equal(w.name, '玩具世界');
  assert.equal(w.events.length, 1);
});

test('T1.3 非法世界给出可读错误（含字段路径）', () => {
  assert.throws(
    () => validateWorld({ ...validWorld, events: [{ id: 'x', label: 'y', weight: -1 }] }),
    (e: unknown) => {
      assert.ok(e instanceof WorldValidateError);
      assert.match(e.message, /\[\$\.events\[0\]\.weight\].*非负/);
      return true;
    },
  );
});

test('事件 id 重复被拒绝', () => {
  const dup = {
    ...validWorld,
    events: [
      { id: 'a', label: '甲', weight: 1 },
      { id: 'a', label: '乙', weight: 1 },
    ],
  };
  assert.throws(() => validateWorld(dup), /\[\$\.events\[1\]\.id\].*重复/);
});

test('缺 endTick 给出路径化错误', () => {
  const { endTick: _drop, ...noEnd } = validWorld;
  assert.throws(() => validateWorld(noEnd), /\[\$\.endTick\]/);
});

test('YAML 文本编译：合法样例通过、YAML 语法错误给可读信息', () => {
  const yamlText = [
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
  const w = compileWorldText(yamlText);
  assert.equal(w.endTick, 80);

  assert.throws(() => compileWorldText('name: [broken\n  bad'), /YAML 解析失败/);
});

test('T2.7 presentation 顶层块：合法通过 + 字段类型错误给路径化错误', () => {
  const w = validateWorld({
    ...validWorld,
    presentation: { demoWeights: true, realRatio: '1/20000', uiNote: '演示比例' },
  });
  assert.equal(w.presentation?.realRatio, '1/20000');
  assert.equal(w.presentation?.demoWeights, true);

  assert.throws(
    () =>
      validateWorld({
        ...validWorld,
        presentation: { demoWeights: 'yes', realRatio: '1/20000', uiNote: '演示比例' },
      }),
    (e: unknown) => {
      assert.ok(e instanceof WorldValidateError);
      assert.match(e.message, /\[\$\.presentation\.demoWeights\].*布尔/);
      return true;
    },
  );
  assert.throws(
    () =>
      validateWorld({
        ...validWorld,
        presentation: { demoWeights: true, realRatio: 42, uiNote: '演示比例' },
      }),
    /\[\$\.presentation\.realRatio\].*字符串/,
  );
  assert.throws(
    () =>
      validateWorld({
        ...validWorld,
        presentation: { demoWeights: true, realRatio: '1/20000', uiNote: '' },
      }),
    /\[\$\.presentation\.uiNote\].*非空/,
  );
});
