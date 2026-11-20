import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWorldText } from './compile.ts';

const baseYaml = [
  'name: 罗小黑测试世界',
  'tickName: 年',
  'startTick: 0',
  'endTick: 100',
  'initAttrs: {lingzhi: 100, tier: 0}',
  'deathModel: liquality_balance',
  'events:',
  '  - {id: condense_complete, label: 凝形, weight: 1}',
  '  - {id: ascend_trigger, label: 升仙, weight: 0.01, terminal: true}',
  'deathRule:',
  '  bands: [{fromTick: 0, hazard: 0.01}]',
  '  attrDeath: {attr: lingzhi, below: 1}',
  'preBirthChain:',
  '  stages: [shengling, jingling, condense, birth]',
  '  shengling: {p: {forest: 0.4, city: 0.1}}',
  '  jingling: {fate: [drift, condense]}',
  '  condense: {prototype: [cat, wolf, flower]}',
  '  rareLine: {reincarnatedSoulP: 0.001}',
  'birthForm:',
  '  weights: {human: 0.35, animal_yao: 0.3, plant_yao: 0.15, fungus_yao: 0.05, spirit_yao: 0.1, painted_yao: 0.05}',
  '  speciesPrototype: {animal_yao: [cat, wolf], plant_yao: [flower, tree]}',
  '  niche: [village_yao, guild_servant]',
  'birthAxes:',
  '  region: [forest, city, guild_land]',
  '  era: [ancient, modern]',
  'cultivationGate:',
  '  step1LiqiManifestP: 0.25',
  '  step2EntryEventP: 0.15',
  '  entryEventAgeWindow: [8, 24]',
  'talent:',
  '  lixi: {yuling: 0.55, shengling: 0.2, suoyu: 0.1, xinling: 0.07, zaowu: 0.07, space: 0.01}',
  '  dualLiqualityP: 0.001',
  '  spaceLixi: {acquired: false}',
  'powerLadder:',
  '  tiers: [fanti, ningxing, yuwu, lingyu, dayao, shengling, ascend]',
  '  tierGates:',
  '    ningxing: {event: condense_complete}',
  '    ascend: {event: ascend_trigger, terminal: true}',
  'hardThresholds:',
  '  t1SubabilityLocked: {rule: same_system_subability_immutable}',
  '  t2SpaceDeathBound: {rule: space_loss_equals_death, exception: dual_essence}',
  '  t3DualEssence: {rarity: two_known_cases}',
  '  multiSystemCap: {1: common, 2: elite, 3: dayao_cap}',
  '  healSystemWorldwide: 7',
  'orgAffiliation:',
  '  guildRegistered: {resourceAccess: plus, shelter: plus}',
  '  unregistered: {riskEventWeight: plus}',
  'namingSkins:',
  '  rule: render_only',
  '  tierGate: {min: dayao}',
  '  skins: {fox_nine_tails: {race: fox_yao, tierMin: dayao, p: 0.02}}',
  'narrativeFeed:',
  '  rule: render_only',
  '  trigger: milestone_events',
  '  milestones: [first_transform, first_guild_join]',
  '  payload: [location, event_type, companion, state_tags]',
  'spiritDensity:',
  '  landmarks: {laojun_alchemy_site: 5.0, hermit_island: 3.0, megacity: 0.5}',
  '  effect: pre_birth_chain_shengling_p',
  'choiceAxes: [cultivation, livelihood, bond, home, spirit_care, stance]',
  'grainAxes: [rooted_vs_drifting, kin_vs_recluse]',
].join('\n');

test('T2.1 schema 完备性：罗小黑 16 块全量世界通过校验与罗小黑断言', () => {
  const w = compileWorldText(baseYaml, '<luoxiaohei-test>', { strict: 'luoxiaohei' });
  assert.equal(w.name, '罗小黑测试世界');
  assert.equal(w.deathModel, 'liquality_balance');
  assert.equal(w.preBirthChain?.stages.length, 4);
  assert.equal(w.birthForm?.weights.human, 0.35);
  assert.deepEqual(w.cultivationGate?.entryEventAgeWindow, [8, 24]);
  assert.equal(w.talent?.spaceLixi.acquired, false);
  assert.equal(w.powerLadder?.tiers.length, 7);
  assert.equal(w.hardThresholds?.healSystemWorldwide, 7);
  assert.equal(w.spiritDensity?.landmarks.laojun_alchemy_site, 5);
  assert.equal(w.narrativeFeed?.milestones.length, 2);
  assert.equal(w.choiceAxes?.length, 6);
});

test('T2.2 断言拒载：空间系 acquired=true（可后天习得）违反硬门槛', () => {
  const bad = baseYaml.replace('spaceLixi: {acquired: false}', 'spaceLixi: {acquired: true}');
  assert.throws(() => compileWorldText(bad, '<bad>', { strict: 'luoxiaohei' }), /space_lixi_locked/);
});

test('T2.2 断言拒载：入口年龄窗越界 [5, 30]', () => {
  const bad = baseYaml.replace('entryEventAgeWindow: [8, 24]', 'entryEventAgeWindow: [5, 30]');
  assert.throws(() => compileWorldText(bad, '<bad>', { strict: 'luoxiaohei' }), /entry_age_window/);
});

test('T2.2 断言拒载：缺 multiSystemCap', () => {
  const bad = baseYaml.replace('  multiSystemCap: {1: common, 2: elite, 3: dayao_cap}', '');
  assert.throws(() => compileWorldText(bad, '<bad>', { strict: 'luoxiaohei' }), /multi_system_cap/);
});

test('T2.2 断言拒载：t2 规则写错（space_loss_equals_death 之外）', () => {
  const bad = baseYaml.replace(
    't2SpaceDeathBound: {rule: space_loss_equals_death, exception: dual_essence}',
    't2SpaceDeathBound: {rule: space_loss_equals_recovery, exception: dual_essence}',
  );
  assert.throws(() => compileWorldText(bad, '<bad>', { strict: 'luoxiaohei' }), /t2_space_death_bound/);
});

test('T2.2 通用断言：tierGates 引用不存在的事件被拒载', () => {
  const bad = baseYaml.replace('ningxing: {event: condense_complete}', 'ningxing: {event: not_exist_event}');
  assert.throws(() => compileWorldText(bad, '<bad>'), /tier_gate_ref/);
});

test('T2.1 块校验：入口概率超 [0,1] 被拒', () => {
  const bad = baseYaml.replace('step1LiqiManifestP: 0.25', 'step1LiqiManifestP: 1.25');
  assert.throws(() => compileWorldText(bad, '<bad>'), /\$\.cultivationGate\.step1LiqiManifestP/);
});
