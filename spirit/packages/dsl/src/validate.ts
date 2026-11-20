import type { World, WorldEvent } from '../../engine/src/types.ts';

export class WorldValidateError extends Error {
  readonly path: string;
  constructor(
    message: string,
    path: string,
  ) {
    super(`[${path}] ${message}`);
    this.path = path;
    this.name = 'WorldValidateError';
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkNumber(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new WorldValidateError(`必须为有限数字（实际：${JSON.stringify(v)}）`, path);
  }
  return v;
}

export function validateWorld(raw: unknown): World {
  if (!isObj(raw)) throw new WorldValidateError('世界必须为映射对象', '$');
  const name = raw['name'];
  if (typeof name !== 'string' || name.length === 0) {
    throw new WorldValidateError('name 必须为非空字符串', '$.name');
  }
  const tickName = raw['tickName'];
  if (typeof tickName !== 'string' || tickName.length === 0) {
    throw new WorldValidateError('tickName 必须为非空字符串', '$.tickName');
  }
  const startTick = checkNumber(raw['startTick'] ?? 0, '$.startTick');
  const endTick = checkNumber(raw['endTick'], '$.endTick');
  if (endTick <= startTick) {
    throw new WorldValidateError(`endTick(${endTick}) 必须大于 startTick(${startTick})`, '$.endTick');
  }
  const initAttrs = raw['initAttrs'];
  if (!isObj(initAttrs)) throw new WorldValidateError('initAttrs 必须为映射对象', '$.initAttrs');
  for (const [k, v] of Object.entries(initAttrs)) {
    checkNumber(v, `$.initAttrs.${k}`);
  }
  const seen = new Set<string>();
  const validEvents = [
    ...validateEventList(raw, 'events', seen),
    ...validateEventList(raw, 'scenes', seen),
    ...validateEventList(raw, 'shocks', seen),
  ];
  const deathRule = raw['deathRule'];
  if (!isObj(deathRule)) throw new WorldValidateError('deathRule 必须为映射对象', '$.deathRule');
  const bands = deathRule['bands'];
  if (!Array.isArray(bands) || bands.length === 0) {
    throw new WorldValidateError('bands 必须为非空数组', '$.deathRule.bands');
  }
  for (let i = 0; i < bands.length; i++) {
    const b = bands[i]!;
    checkNumber(b['fromTick'], `$.deathRule.bands[${i}].fromTick`);
    checkNumber(b['hazard'], `$.deathRule.bands[${i}].hazard`);
  }
  let deathModel: World['deathModel'];
  if (raw['deathModel'] !== undefined) {
    if (raw['deathModel'] !== 'lifetable' && raw['deathModel'] !== 'liquality_balance') {
      throw new WorldValidateError('deathModel 必须为 lifetable 或 liquality_balance', '$.deathModel');
    }
    deathModel = raw['deathModel'];
  }
  const world: World = {
    name,
    tickName,
    startTick,
    endTick,
    initAttrs: initAttrs as Record<string, number>,
    events: validEvents,
    deathRule: deathRule as unknown as World['deathRule'],
    deathModel,
  };
  checkOptionalBlocks(raw, world);
  return world;
}

function validateEventList(
  raw: Record<string, unknown>,
  key: 'events' | 'scenes' | 'shocks',
  seen: Set<string>,
): WorldEvent[] {
  const list = raw[key];
  if (list === undefined) {
    if (key === 'events') throw new WorldValidateError('events 必须为非空数组', '$.events');
    return [];
  }
  if (!Array.isArray(list) || (key === 'events' && list.length === 0)) {
    throw new WorldValidateError(`${key} 必须为${key === 'events' ? '非空' : ''}数组`, `$.${key}`);
  }
  const out: WorldEvent[] = [];
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    const p = `$.${key}[${i}]`;
    if (!isObj(e)) throw new WorldValidateError('事件必须为映射对象', p);
    const id = e['id'];
    if (typeof id !== 'string' || id.length === 0) {
      throw new WorldValidateError('id 必须为非空字符串', `${p}.id`);
    }
    if (seen.has(id)) {
      throw new WorldValidateError(`事件 id 重复："${id}"`, `${p}.id`);
    }
    seen.add(id);
    const label = e['label'];
    if (typeof label !== 'string' || label.length === 0) {
      throw new WorldValidateError('label 必须为非空字符串', `${p}.label`);
    }
    const weight = checkNumber(e['weight'], `${p}.weight`);
    if (weight < 0) {
      throw new WorldValidateError(`weight 必须为非负数（实际：${weight}）`, `${p}.weight`);
    }
    if (e['effects'] !== undefined && !isObj(e['effects'])) {
      throw new WorldValidateError('effects 必须为映射对象', `${p}.effects`);
    }
    if (e['cond'] !== undefined && !isObj(e['cond'])) {
      throw new WorldValidateError('cond 必须为映射对象', `${p}.cond`);
    }
    if (e['gainFlags'] !== undefined && !Array.isArray(e['gainFlags'])) {
      throw new WorldValidateError('gainFlags 必须为数组', `${p}.gainFlags`);
    }
    if (e['lossFlags'] !== undefined) {
      checkStringArray(e['lossFlags'], `${p}.lossFlags`);
    }
    if (e['choice'] !== undefined) {
      const c = e['choice'];
      const cp = `${p}.choice`;
      if (!isObj(c)) throw new WorldValidateError('choice 必须为映射对象', cp);
      if (typeof c['prompt'] !== 'string') {
        throw new WorldValidateError('prompt 必须为字符串', `${cp}.prompt`);
      }
      const opts = c['options'];
      if (!Array.isArray(opts) || opts.length === 0) {
        throw new WorldValidateError('options 必须为非空数组', `${cp}.options`);
      }
      for (let j = 0; j < opts.length; j++) {
        const o = opts[j]!;
        const op = `${cp}.options[${j}]`;
        if (!isObj(o)) throw new WorldValidateError('选项必须为映射对象', op);
        if (typeof o['label'] !== 'string') {
          throw new WorldValidateError('label 必须为字符串', `${op}.label`);
        }
        if (o['weight'] !== undefined) checkNumber(o['weight'], `${op}.weight`);
      }
    }
    if (e['terminal'] !== undefined && typeof e['terminal'] !== 'boolean') {
      throw new WorldValidateError('terminal 必须为布尔值', `${p}.terminal`);
    }
    if (e['firstFlag'] !== undefined && typeof e['firstFlag'] !== 'string') {
      throw new WorldValidateError('firstFlag 必须为字符串', `${p}.firstFlag`);
    }
    if (e['source'] !== undefined && !['events', 'scenes', 'shocks'].includes(e['source'] as string)) {
      throw new WorldValidateError(`source 必须为 events/scenes/shocks（实际：${JSON.stringify(e['source'])}）`, `${p}.source`);
    }
    const ev = e as unknown as WorldEvent;
    if (ev.source === undefined) ev.source = key;
    out.push(ev);
  }
  return out;
}

function checkStringArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) throw new WorldValidateError(`必须为字符串数组`, path);
  for (let i = 0; i < v.length; i++) {
    if (typeof v[i] !== 'string' || (v[i] as string).length === 0) {
      throw new WorldValidateError('必须为非空字符串', `${path}[${i}]`);
    }
  }
  return v as string[];
}

function checkNumMap(v: unknown, path: string, range?: [number, number]): Record<string, number> {
  if (!isObj(v)) throw new WorldValidateError('必须为数值映射对象', path);
  for (const [k, x] of Object.entries(v)) {
    const n = checkNumber(x, `${path}.${k}`);
    if (range && (n < range[0] || n > range[1])) {
      throw new WorldValidateError(`数值须在 [${range[0]}, ${range[1]}] 内（实际：${n}）`, `${path}.${k}`);
    }
  }
  return v as Record<string, number>;
}

function checkProbability(v: unknown, path: string): number {
  const n = checkNumber(v, path);
  if (n < 0 || n > 1) {
    throw new WorldValidateError(`概率须在 [0, 1] 内（实际：${n}）`, path);
  }
  return n;
}

function checkOptionalBlocks(raw: Record<string, unknown>, world: World): void {
  if (raw['preBirthChain'] !== undefined) {
    const p = '$.preBirthChain';
    const c = raw['preBirthChain'];
    if (!isObj(c)) throw new WorldValidateError('必须为映射对象', p);
    checkStringArray(c['stages'], `${p}.stages`);
    if (!isObj(c['shengling']) || !isObj((c['shengling'] as Record<string, unknown>)['p'])) {
      throw new WorldValidateError('shengling.p 必须为数值映射（地标→凝聚概率）', `${p}.shengling.p`);
    }
    checkNumMap((c['shengling'] as Record<string, unknown>)['p'], `${p}.shengling.p`);
    checkStringArray((c['jingling'] as Record<string, unknown> | undefined)?.['fate'] ?? c['jingling'], `${p}.jingling.fate`);
    checkStringArray((c['condense'] as Record<string, unknown> | undefined)?.['prototype'] ?? c['condense'], `${p}.condense.prototype`);
    if (c['rareLine'] !== undefined) {
      checkNumber((c['rareLine'] as Record<string, unknown>)['reincarnatedSoulP'], `${p}.rareLine.reincarnatedSoulP`);
    }
    world.preBirthChain = c as unknown as World['preBirthChain'];
  }
  if (raw['birthForm'] !== undefined) {
    const p = '$.birthForm';
    const b = raw['birthForm'];
    if (!isObj(b)) throw new WorldValidateError('必须为映射对象', p);
    checkNumMap(b['weights'], `${p}.weights`);
    if (!isObj(b['speciesPrototype'])) {
      throw new WorldValidateError('speciesPrototype 必须为映射（形态→物种原型数组）', `${p}.speciesPrototype`);
    }
    for (const [k, v] of Object.entries(b['speciesPrototype'] as Record<string, unknown>)) {
      checkStringArray(v, `${p}.speciesPrototype.${k}`);
    }
    if (b['speciesVariety'] !== undefined) {
      if (!isObj(b['speciesVariety'])) {
        throw new WorldValidateError('speciesVariety 必须为映射（物种→品种数组）', `${p}.speciesVariety`);
      }
      for (const [k, v] of Object.entries(b['speciesVariety'] as Record<string, unknown>)) {
        checkStringArray(v, `${p}.speciesVariety.${k}`);
      }
    }
    checkStringArray(b['niche'], `${p}.niche`);
    world.birthForm = b as unknown as World['birthForm'];
  }
  if (raw['birthAxes'] !== undefined) {
    const p = '$.birthAxes';
    const b = raw['birthAxes'];
    if (!isObj(b)) throw new WorldValidateError('必须为映射对象', p);
    checkStringArray(b['region'], `${p}.region`);
    checkStringArray(b['era'], `${p}.era`);
    world.birthAxes = b as unknown as World['birthAxes'];
  }
  if (raw['cultivationGate'] !== undefined) {
    const p = '$.cultivationGate';
    const g = raw['cultivationGate'];
    if (!isObj(g)) throw new WorldValidateError('必须为映射对象', p);
    checkProbability(g['step1LiqiManifestP'], `${p}.step1LiqiManifestP`);
    checkProbability(g['step2EntryEventP'], `${p}.step2EntryEventP`);
    const w = g['entryEventAgeWindow'];
    if (!Array.isArray(w) || w.length !== 2) {
      throw new WorldValidateError('entryEventAgeWindow 必须为 [min, max] 二元数组', `${p}.entryEventAgeWindow`);
    }
    const wMin = checkNumber(w[0], `${p}.entryEventAgeWindow[0]`);
    const wMax = checkNumber(w[1], `${p}.entryEventAgeWindow[1]`);
    if (wMin >= wMax) {
      throw new WorldValidateError(`入口年龄窗 min(${wMin}) 必须小于 max(${wMax})`, `${p}.entryEventAgeWindow`);
    }
    world.cultivationGate = g as unknown as World['cultivationGate'];
  }
  if (raw['talent'] !== undefined) {
    const p = '$.talent';
    const t = raw['talent'];
    if (!isObj(t)) throw new WorldValidateError('必须为映射对象', p);
    checkNumMap(t['lixi'], `${p}.lixi`, [0, 1]);
    checkProbability(t['dualLiqualityP'], `${p}.dualLiqualityP`);
    if (!isObj(t['spaceLixi']) || typeof (t['spaceLixi'] as Record<string, unknown>)['acquired'] !== 'boolean') {
      throw new WorldValidateError('spaceLixi.acquired 必须为布尔值', `${p}.spaceLixi.acquired`);
    }
    if (t['envModifier'] !== undefined) {
      if (!isObj(t['envModifier'])) throw new WorldValidateError('envModifier 必须为映射', `${p}.envModifier`);
      for (const [k, v] of Object.entries(t['envModifier'] as Record<string, unknown>)) {
        checkNumMap(v, `${p}.envModifier.${k}`);
      }
    }
    world.talent = t as unknown as World['talent'];
  }
  if (raw['powerLadder'] !== undefined) {
    const p = '$.powerLadder';
    const l = raw['powerLadder'];
    if (!isObj(l)) throw new WorldValidateError('必须为映射对象', p);
    checkStringArray(l['tiers'], `${p}.tiers`);
    if (!isObj(l['tierGates'])) throw new WorldValidateError('tierGates 必须为映射', `${p}.tierGates`);
    for (const [tier, g] of Object.entries(l['tierGates'] as Record<string, unknown>)) {
      const gp = `${p}.tierGates.${tier}`;
      if (!isObj(g)) throw new WorldValidateError('必须为映射对象', gp);
      if (typeof (g as Record<string, unknown>)['event'] !== 'string') {
        throw new WorldValidateError('event 必须为字符串（突破事件 id）', `${gp}.event`);
      }
      if ((g as Record<string, unknown>)['p'] !== undefined) {
        checkProbability((g as Record<string, unknown>)['p'], `${gp}.p`);
      }
    }
    world.powerLadder = l as unknown as World['powerLadder'];
  }
  if (raw['hardThresholds'] !== undefined) {
    const h = raw['hardThresholds'];
    if (!isObj(h)) throw new WorldValidateError('必须为映射对象', '$.hardThresholds');
    world.hardThresholds = h as unknown as World['hardThresholds'];
  }
  if (raw['orgAffiliation'] !== undefined) {
    if (!isObj(raw['orgAffiliation'])) throw new WorldValidateError('必须为映射对象', '$.orgAffiliation');
    world.orgAffiliation = raw['orgAffiliation'] as unknown as World['orgAffiliation'];
  }
  if (raw['namingSkins'] !== undefined) {
    const n = raw['namingSkins'];
    if (!isObj(n) || typeof (n as Record<string, unknown>)['rule'] !== 'string') {
      throw new WorldValidateError('rule 必须为字符串', '$.namingSkins.rule');
    }
    world.namingSkins = n as unknown as World['namingSkins'];
  }
  if (raw['narrativeFeed'] !== undefined) {
    const n = raw['narrativeFeed'];
    if (!isObj(n)) throw new WorldValidateError('必须为映射对象', '$.narrativeFeed');
    checkStringArray((n as Record<string, unknown>)['milestones'], '$.narrativeFeed.milestones');
    world.narrativeFeed = n as unknown as World['narrativeFeed'];
  }
  if (raw['spiritDensity'] !== undefined) {
    const s = raw['spiritDensity'];
    if (!isObj(s)) throw new WorldValidateError('必须为映射对象', '$.spiritDensity');
    checkNumMap((s as Record<string, unknown>)['landmarks'], '$.spiritDensity.landmarks');
    world.spiritDensity = s as unknown as World['spiritDensity'];
  }
  if (raw['presentation'] !== undefined) {
    const pr = raw['presentation'];
    const p = '$.presentation';
    if (!isObj(pr)) throw new WorldValidateError('必须为映射对象', p);
    if (typeof (pr as Record<string, unknown>)['demoWeights'] !== 'boolean') {
      throw new WorldValidateError('demoWeights 必须为布尔值', `${p}.demoWeights`);
    }
    if (typeof (pr as Record<string, unknown>)['realRatio'] !== 'string') {
      throw new WorldValidateError('realRatio 必须为字符串（真实人口比例提示）', `${p}.realRatio`);
    }
    if (typeof (pr as Record<string, unknown>)['uiNote'] !== 'string' || ((pr as Record<string, unknown>)['uiNote'] as string).length === 0) {
      throw new WorldValidateError('uiNote 必须为非空字符串（UI 明示文案）', `${p}.uiNote`);
    }
    world.presentation = pr as unknown as World['presentation'];
  }
  if (raw['choiceAxes'] !== undefined) checkStringArray(raw['choiceAxes'], '$.choiceAxes');
  if (raw['choiceAxes'] !== undefined) world.choiceAxes = raw['choiceAxes'] as string[];
  if (raw['grainAxes'] !== undefined) checkStringArray(raw['grainAxes'], '$.grainAxes');
  if (raw['grainAxes'] !== undefined) world.grainAxes = raw['grainAxes'] as string[];
}
