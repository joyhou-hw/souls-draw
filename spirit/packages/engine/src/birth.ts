import type { BirthOutcome, LogEntry, World } from './types.ts';
import type { Rng } from './rng.ts';

export const SPIRIT_DENSITY_BONUS = 0.2;

function pickUniform<T>(items: readonly T[], rng: Rng): T {
  return rng.pick(items);
}

function weightedPickRecord(rec: Record<string, number>, rng: Rng): string {
  return rng.weightedPick(Object.entries(rec).map(([item, weight]) => ({ item, weight })));
}

export function resolveShenglingP(world: World, region: string): number {
  const chain = world.preBirthChain;
  if (!chain) return 1;
  const values = Object.values(chain.shengling.p);
  const base = chain.shengling.p[region] ?? (values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 1);
  const density = world.spiritDensity?.landmarks[region] ?? 0;
  return Math.min(1, base * (1 + SPIRIT_DENSITY_BONUS * density));
}

function pickSpecies(world: World, form: string, rng: Rng): string | undefined {
  const pool = world.birthForm?.speciesPrototype[form];
  if (!pool || pool.length === 0) return undefined;
  return pickUniform(pool, rng);
}

function pickVariety(world: World, species: string | undefined, rng: Rng): string | undefined {
  if (!species) return undefined;
  const pool = world.birthForm?.speciesVariety?.[species];
  if (!pool || pool.length === 0) return undefined;
  return pickUniform(pool, rng);
}

function pickLixi(world: World, region: string, rng: Rng): string {
  const talent = world.talent;
  if (!talent) return 'none';
  const modifier = talent.envModifier?.[region] ?? {};
  const entries = Object.entries(talent.lixi).map(([item, weight]) => ({
    item,
    weight: Math.max(0, weight * (modifier[item] ?? 1)),
  }));
  if (entries.length === 0) return 'none';
  return rng.weightedPick(entries);
}

export function generateBirth(world: World, rng: Rng): BirthOutcome {
  const chain = world.preBirthChain;
  const humanKey = chain?.humanLine ?? 'human';
  const preBirthLog: LogEntry[] = [];

  const reincarnatedSoul = chain?.rareLine ? rng.next() < chain.rareLine.reincarnatedSoulP : false;
  const region = world.birthAxes ? pickUniform(world.birthAxes.region, rng) : 'unknown';
  const era = world.birthAxes ? pickUniform(world.birthAxes.era, rng) : 'unknown';
  const form = weightedPickRecord(world.birthForm!.weights, rng);
  const isHuman = form === humanKey;

  let species: string | undefined;
  let variety: string | undefined;
  let niche: string | undefined;
  if (isHuman) {
    preBirthLog.push({
      tick: -1,
      eventId: 'pre_birth/human_line',
      label: reincarnatedSoul
        ? `强大魂灵凝而不散，携前世记忆投胎于${region}`
        : `魂灵投胎于${region}（${era}）`,
    });
  } else {
    species = pickSpecies(world, form, rng);
    variety = pickVariety(world, species, rng);
    niche = world.birthForm!.niche.length > 0 ? pickUniform(world.birthForm!.niche, rng) : undefined;

    const p = resolveShenglingP(world, region);
    const smooth = rng.next() < p;
    preBirthLog.push({
      tick: -3,
      eventId: 'pre_birth/shengling',
      label: smooth
        ? `生灵于${region}顺遂凝聚（灵气充盈）`
        : `生灵于${region}凝聚坎坷（灵气稀薄，漂泊辗转方成）`,
    });

    const fatePool = chain?.jingling.fate ?? [];
    const fate = fatePool.length > 0 ? pickUniform(fatePool, rng) : '自然凝形';
    preBirthLog.push({
      tick: -2,
      eventId: 'pre_birth/jingling',
      label: `精灵期（无实体）：${fate}`,
    });

    preBirthLog.push({
      tick: -1,
      eventId: 'pre_birth/condense',
      label: species ? `凝形为${species}${variety ? `（${variety}）` : ''}形${form}，结合物质灵降生` : `凝形为${form}，结合物质灵降生`,
    });
  }

  const gate = world.cultivationGate;
  const liqiManifest = gate ? rng.next() < gate.step1LiqiManifestP : false;
  let lixi: string | undefined;
  let dualLixi = false;
  let cultivator = false;
  if (liqiManifest) {
    lixi = world.talent ? pickLixi(world, region, rng) : undefined;
    dualLixi = world.talent ? rng.next() < world.talent.dualLiqualityP : false;
    cultivator = gate ? rng.next() < gate.step2EntryEventP : false;
  }

  const birthLabel = isHuman
    ? `出生：人类（${region}·${era}）`
    : `出生：${form}${species ? `·${species}${variety ? `·${variety}` : ''}` : ''}（${region}·${era}）`;
  let gateLabel: string;
  if (!gate) {
    gateLabel = '此界无修行体系';
  } else if (!liqiManifest) {
    gateLabel = '灵力未显性——凡人/平凡一生';
  } else if (!cultivator) {
    gateLabel = '灵力显性而未遇入口——埋没天才线';
  } else {
    gateLabel = `双闸皆过——入修行线（灵系：${lixi ?? 'none'}${dualLixi ? '，双灵质' : ''}）`;
  }
  preBirthLog.push({ tick: 0, eventId: 'birth', label: `${birthLabel}；${gateLabel}` });

  return {
    form,
    species,
    variety,
    niche,
    region,
    era,
    lixi,
    dualLixi,
    reincarnatedSoul,
    liqiManifest,
    cultivator,
    preBirthLog,
  };
}

export function birthFlags(birth: BirthOutcome): string[] {
  const flags: string[] = [
    `form:${birth.form}`,
    `region:${birth.region}`,
    `era:${birth.era}`,
  ];
  if (birth.species) flags.push(`species:${birth.species}`);
  if (birth.niche) flags.push(`niche:${birth.niche}`);
  if (birth.lixi) flags.push(`lixi:${birth.lixi}`);
  if (birth.dualLixi) flags.push('dual_lix');
  if (birth.reincarnatedSoul) flags.push('reincarnated_soul');
  if (birth.liqiManifest) flags.push('liqi_manifest');
  if (birth.cultivator) flags.push('cultivator');
  if (birth.form === 'plant_yao' || birth.form === 'fungus_yao') flags.push('rooted');
  if (birth.form === 'spirit_yao') flags.push('intangible');
  if (birth.form === 'painted_yao') flags.push('flag:painted_unnamed');
  return flags;
}
