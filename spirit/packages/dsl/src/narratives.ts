import type { EventNarratives, InterludeCategory, Narratives, NarrativeVariant, World } from '../../engine/src/types.ts';
import { NARRATIVE_SLOTS } from '../../engine/src/types.ts';

export class NarrativesValidateError extends Error {
  readonly path: string;
  constructor(message: string, path: string) {
    super(`[${path}] ${message}`);
    this.path = path;
    this.name = 'NarrativesValidateError';
  }
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const SLOT_RE = /\{([a-z_]+)\}/g;

function checkSlots(text: string, path: string): void {
  if ((text.match(/\{/g) ?? []).length !== (text.match(/\}/g) ?? []).length) {
    throw new NarrativesValidateError(`花括号必须成对出现："${text}"`, path);
  }
  SLOT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLOT_RE.exec(text)) !== null) {
    const slot = m[1]!;
    if (!(NARRATIVE_SLOTS as readonly string[]).includes(slot)) {
      throw new NarrativesValidateError(
        `未知槽位 "{${slot}}"（可用槽位：${NARRATIVE_SLOTS.join(', ')}）`,
        path,
      );
    }
  }
}

function checkVariantList(v: unknown, path: string, seenIds: Set<string>): void {
  if (!Array.isArray(v) || v.length === 0) {
    throw new NarrativesValidateError('必须为非空变体数组', path);
  }
  for (let i = 0; i < v.length; i++) {
    const item = v[i]!;
    const p = `${path}[${i}]`;
    if (!isObj(item)) throw new NarrativesValidateError('变体必须为映射对象', p);
    const id = item['id'];
    if (typeof id !== 'string' || id.length === 0 || !/^[a-z0-9_]+$/.test(id)) {
      throw new NarrativesValidateError('id 必须为非空小写蛇形字符串（如 qy_a_01）', `${p}.id`);
    }
    if (seenIds.has(id)) {
      throw new NarrativesValidateError(`变体 id 全局重复："${id}"（不放回抽样的键必须唯一）`, `${p}.id`);
    }
    seenIds.add(id);
    const text = item['text'];
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new NarrativesValidateError('text 必须为非空字符串', `${p}.text`);
    }
    checkSlots(text, `${p}.text`);
  }
}

function checkBuckets(raw: unknown, path: string, world: World, seenIds: Set<string>): void {
  if (!Array.isArray(raw)) throw new NarrativesValidateError('buckets 必须为数组', path);
  for (let i = 0; i < raw.length; i++) {
    const b = raw[i]!;
    const p = `${path}[${i}]`;
    if (!isObj(b)) throw new NarrativesValidateError('桶必须为映射对象', p);
    const when = b['when'];
    if (when !== undefined) {
      const wp = `${p}.when`;
      if (!isObj(when)) throw new NarrativesValidateError('when 必须为映射对象', wp);
      if (when['form'] !== undefined) {
        if (world.birthForm && !world.birthForm.weights[when['form'] as string]) {
          throw new NarrativesValidateError(
            `when.form "${when['form']}" 不在 birthForm.weights 取值内`,
            `${wp}.form`,
          );
        }
      }
      if (when['region'] !== undefined) {
        if (world.birthAxes && !world.birthAxes.region.includes(when['region'] as string)) {
          throw new NarrativesValidateError(
            `when.region "${when['region']}" 不在 birthAxes.region 取值内`,
            `${wp}.region`,
          );
        }
      }
      if (when['era'] !== undefined) {
        if (world.birthAxes && !world.birthAxes.era.includes(when['era'] as string)) {
          throw new NarrativesValidateError(
            `when.era "${when['era']}" 不在 birthAxes.era 取值内`,
            `${wp}.era`,
          );
        }
      }
      if (when['flags'] !== undefined) {
        if (!Array.isArray(when['flags']) || (when['flags'] as unknown[]).some(f => typeof f !== 'string')) {
          throw new NarrativesValidateError('when.flags 必须为字符串数组', `${wp}.flags`);
        }
      }
    }
    checkVariantList(b['variants'], `${p}.variants`, seenIds);
  }
}

export function validateNarratives(raw: unknown, world: World, source = '<narratives>'): Narratives {
  const err = (message: string, path: string): never => {
    throw new NarrativesValidateError(`${source}: ${message}`, path);
  };
  if (!isObj(raw)) throw err('narratives 必须为映射对象', '$');
  if (raw['version'] !== 1) err('version 必须为 1', '$.version');

  const seenIds = new Set<string>();
  const out: Narratives = { version: 1 };

  if (raw['openers'] !== undefined) {
    checkVariantList(raw['openers'], '$.openers', seenIds);
    out.openers = raw['openers'] as NarrativeVariant[];
  }
  if (raw['slots'] !== undefined) {
    if (!isObj(raw['slots'])) throw err('slots 必须为映射（槽位名 → 枚举值 → 中文呈现）', '$.slots');
    const slotsOut: Record<string, Record<string, string>> = {};
    for (const [slotName, mappingRaw] of Object.entries(raw['slots'])) {
      if (!(NARRATIVE_SLOTS as readonly string[]).includes(slotName)) {
        err(`slots 键必须是合法槽位名："${slotName}"`, `$.slots.${slotName}`);
      }
      if (!isObj(mappingRaw)) throw err(`slots.${slotName} 必须为映射（枚举值 → 中文呈现）`, `$.slots.${slotName}`);
      const mapping: Record<string, string> = {};
      for (const [enumKey, label] of Object.entries(mappingRaw)) {
        if (typeof label !== 'string' || label.length === 0) {
          err(`呈现必须为非空字符串："${enumKey}"`, `$.slots.${slotName}.${enumKey}`);
        }
        mapping[enumKey] = label as string;
      }
      slotsOut[slotName] = mapping;
    }
    out.slots = slotsOut;
  }
  if (raw['closers'] !== undefined) {
    checkVariantList(raw['closers'], '$.closers', seenIds);
    out.closers = raw['closers'] as NarrativeVariant[];
  }

  const eventIds = new Set(world.events.map(e => e.id));
  const eventsRaw = raw['events'];
  if (eventsRaw !== undefined) {
    if (!isObj(eventsRaw)) throw err('events 必须为映射（事件 id → 叙事配置）', '$.events');
    const eventsOut: Record<string, EventNarratives> = {};
    for (const [eventId, cfgRaw] of Object.entries(eventsRaw)) {
      const p = `$.events.${eventId}`;
      if (!eventIds.has(eventId)) {
        err(`事件 id 不存在于 events/scenes/shocks 三池："${eventId}"`, p);
      }
      if (!isObj(cfgRaw)) throw err('事件叙事配置必须为映射对象', p);
      if (cfgRaw['prompt'] !== undefined && typeof cfgRaw['prompt'] !== 'string') {
        err('prompt 必须为字符串（抉择提示语变体）', `${p}.prompt`);
      }
      if (cfgRaw['fallback'] !== undefined) {
        checkVariantList(cfgRaw['fallback'], `${p}.fallback`, seenIds);
      }
      if (cfgRaw['buckets'] !== undefined) {
        checkBuckets(cfgRaw['buckets'], `${p}.buckets`, world, seenIds);
      }
      if (cfgRaw['fallback'] === undefined && cfgRaw['buckets'] === undefined && cfgRaw['prompt'] === undefined) {
        err('事件叙事配置至少要有 prompt / fallback / buckets 之一', p);
      }
      eventsOut[eventId] = cfgRaw as unknown as NonNullable<Narratives['events']>[string];
    }
    out.events = eventsOut;
  }

  const milestonesRaw = raw['milestones'];
  if (milestonesRaw !== undefined) {
    if (!isObj(milestonesRaw)) throw err('milestones 必须为映射（里程碑 → 题注变体数组）', '$.milestones');
    const declared = world.narrativeFeed?.milestones;
    if (!declared || declared.length === 0) {
      err('世界包未声明 narrativeFeed.milestones，不能配置 milestones 题注', '$.milestones');
    }
    const milestonesOut: Record<string, NarrativeVariant[]> = {};
    for (const [milestone, list] of Object.entries(milestonesRaw)) {
      const p = `$.milestones.${milestone}`;
      if (!declared!.includes(milestone)) {
        err(`里程碑 "${milestone}" 未在 narrativeFeed.milestones 声明`, p);
      }
      checkVariantList(list, p, seenIds);
      milestonesOut[milestone] = list as NarrativeVariant[];
    }
    out.milestones = milestonesOut;
  }

  const interludesRaw = raw['interludes'];
  if (interludesRaw !== undefined) {
    if (!isObj(interludesRaw)) throw err('interludes 必须为映射（类别名 → 插页配置）', '$.interludes');
    const interludesOut: Record<string, InterludeCategory> = {};
    for (const [catName, catRaw] of Object.entries(interludesRaw)) {
      const p = `$.interludes.${catName}`;
      if (!isObj(catRaw)) throw err(`插页类别 "${catName}" 必须为映射对象`, p);
      const cat: InterludeCategory = { variants: [] };
      if (catRaw['minTick'] !== undefined) {
        if (typeof catRaw['minTick'] !== 'number') throw err('minTick 必须为数字', `${p}.minTick`);
        cat.minTick = catRaw['minTick'];
      }
      if (catRaw['maxTick'] !== undefined) {
        if (typeof catRaw['maxTick'] !== 'number') throw err('maxTick 必须为数字', `${p}.maxTick`);
        cat.maxTick = catRaw['maxTick'];
      }
      if (catRaw['cultivatorOnly'] !== undefined) {
        if (typeof catRaw['cultivatorOnly'] !== 'boolean') throw err('cultivatorOnly 必须为布尔值', `${p}.cultivatorOnly`);
        cat.cultivatorOnly = catRaw['cultivatorOnly'];
      }
      if (catRaw['mortalOnly'] !== undefined) {
        if (typeof catRaw['mortalOnly'] !== 'boolean') throw err('mortalOnly 必须为布尔值', `${p}.mortalOnly`);
        cat.mortalOnly = catRaw['mortalOnly'];
      }
      if (catRaw['variants'] === undefined) throw err(`插页类别 "${catName}" 缺少 variants`, `${p}.variants`);
      checkVariantList(catRaw['variants'], `${p}.variants`, seenIds);
      cat.variants = catRaw['variants'] as NarrativeVariant[];
      interludesOut[catName] = cat;
    }
    out.interludes = interludesOut;
  }

  if (!out.events && !out.milestones && !out.openers && !out.closers && !out.interludes) {
    err('narratives 不能为空（至少一个事件变体或里程碑题注）', '$');
  }
  return out;
}
