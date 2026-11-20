import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { loadWorldFile, loadWorldPack } from '../../dsl/src/index.ts';
import {
  autoResolveChoice,
  renderLifeLog,
  runLife,
  runBatch,
  statsToCsv,
  type BatchStats,
  type LifeResult,
  type World,
} from '../../engine/src/index.ts';

interface CliArgs {
  world: string;
  seed: number;
  auto: boolean;
  choices: number[];
  out?: string;
  batch?: number;
  format?: 'json' | 'csv';
  narrate: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { world: 'worlds/toy/world.yaml', seed: 12345, auto: false, choices: [], narrate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--world') args.world = argv[++i] ?? '';
    else if (a === '--seed') args.seed = Number(argv[++i]);
    else if (a === '--auto') args.auto = true;
    else if (a === '--narrate') args.narrate = true;
    else if (a === '--choice') args.choices.push(Number(argv[++i]) - 1);
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--batch') args.batch = Number(argv[++i]);
    else if (a === '--format') {
      const f = argv[++i];
      if (f !== 'json' && f !== 'csv') {
        console.error(`--format 仅支持 json 或 csv，收到: ${f}`);
        process.exit(1);
      }
      args.format = f;
    } else if (a === '--help' || a === '-h') {
      console.log('用法: node main.ts [--world <dir|path>] [--seed <n>] [--auto] [--choice <n>]... [--out <path>]');
      console.log('       node main.ts [--world <dir|path>] --batch <n> [--format json|csv] [--out <path>]');
      console.log('  --world   世界目录（如 worlds/luoxiaohei，自动加载同目录 narratives.yaml）或单个 yaml 文件路径');
      console.log('  --auto    抉择点按选项权重掷骰自动决定（默认且未指定 --choice 时生效）');
      console.log('  --narrate 叙事渲染模式：用 narratives.yaml 文本库渲染每一年（须世界包含 narratives 块）');
      console.log('  --choice  预设抉择序号（1 起，可多次），按触发顺序消费，耗尽后自动');
      console.log('  --batch   批量模拟 <n> 条人生并输出统计（无 UI batch_sim）');
      console.log('  --format  批量统计导出格式（默认 json；--out 扩展名为 .csv 时自动 csv）');
      process.exit(0);
    } else {
      console.error(`未知参数: ${a}`);
      process.exit(1);
    }
  }
  return args;
}

function renderLife(result: LifeResult, world: World, narrate: boolean): void {
  console.log(`\n《生灵引》一条人生 —— 世界「${result.world}」 seed=${result.seed}`);
  console.log('─'.repeat(56));
  // 叙事渲染交给 engine 共享出口（叙事 rng 独立，不影响人生掷骰铁律）
  const lines = narrate ? renderLifeLog(world, result) : undefined;
  for (let i = 0; i < result.log.length; i++) {
    const e = result.log[i]!;
    const changes = e.effects
      ? ' ' +
        Object.entries(e.effects)
          .map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`)
          .join(' ')
      : '';
    const choiceNote = e.choice ? `（抉择：${e.choice.picked}）` : '';
    const age = `  第 ${String(e.tick).padStart(2)} 年 |`;
    const line = lines?.[i];
    if (line?.isPrompt) {
      console.log(`${age} ❈ ${line.text}`);
      console.log(`          → ${line.picked ?? ''}${changes}`);
      continue;
    }
    const text = line?.text ?? e.label;
    const caption = line?.caption ? ` 〔${line.caption}〕` : '';
    console.log(`${age} ${text}${changes}${choiceNote}${caption}`);
  }
  console.log('─'.repeat(56));
  if (result.deathTick !== null) {
    const cause = result.deathCause === 'health' ? '油尽灯枯（health 跌破下限）' : '命数已尽（生命表掷骰）';
    console.log(`  终年 ${result.deathTick}，${cause}。`);
  } else {
    console.log(`  活到 ${result.state.tick} 岁，一生未竟。`);
  }
}

function renderSummary(result: LifeResult): string {
  return JSON.stringify(
    {
      world: result.world,
      seed: result.seed,
      alive: result.state.alive,
      deathTick: result.deathTick,
      deathCause: result.deathCause,
      finalAttrs: result.state.attrs,
      flags: result.state.flags,
      eventCount: result.log.length,
    },
    null,
    2,
  );
}

function distTable(dist: Record<string, number>, keyName: string, count: number): void {
  const rows = Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ [keyName]: k, 条数: v, 占比: `${((v / count) * 100).toFixed(2)}%` }));
  if (rows.length > 0) console.table(rows);
}

function renderBatchStats(stats: BatchStats): void {
  console.log(`\n《生灵引》批量模拟 —— 世界「${stats.worldName}」 ${stats.count} 条人生`);
  console.log('─'.repeat(56));
  console.table([
    { 指标: '修行者率', 值: `${(stats.cultivatorRate * 100).toFixed(2)}%` },
    { 指标: '平均终年', 值: stats.avgDeathTick.toFixed(1) },
  ]);
  console.log('形态分布：');
  distTable(stats.formDist, '形态', stats.count);
  console.log('灵系分布（显性灵质者）：');
  distTable(stats.lixiDist, '灵系', stats.count);
  console.log('死因分布：');
  distTable(stats.deathCauseDist, '死因', stats.count);
  console.log('灵力阶梯定档分布：');
  distTable(stats.tierDist, '档位', stats.count);
}

function writeOut(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf-8');
}

function resolveWorld(worldArg: string): World {
  // 传目录 → 目录下的 world.yaml + narratives.yaml 一起加载
  if (statSync(worldArg, { throwIfNoEntry: false })?.isDirectory()) {
    return loadWorldPack(worldArg);
  }
  const base = basename(worldArg);
  if (base === 'world.yaml' || base === 'world.yml') {
    // 直接传 world.yaml → 仍按包加载，顺带带上同目录 narratives.yaml
    return loadWorldPack(dirname(worldArg));
  }
  // 任意其他 yaml 文件 → 单文件加载（不含叙事库）
  return loadWorldFile(worldArg);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const world = resolveWorld(args.world);
  if (args.batch !== undefined) {
    const stats = runBatch(world, { count: args.batch, seedStart: args.seed });
    renderBatchStats(stats);
    if (args.out) {
      const useCsv =
        args.format === 'csv' || (args.format === undefined && args.out.endsWith('.csv'));
      writeOut(args.out, useCsv ? statsToCsv(stats) : JSON.stringify(stats, null, 2));
      console.error(`\n已写入 ${args.out}（${useCsv ? 'CSV' : 'JSON'}）`);
    }
    return;
  }
  let choiceCursor = 0;
  const result = runLife(world, {
    seed: args.seed,
    resolveChoice: (choice, _state, rng) => {
      if (choiceCursor < args.choices.length) {
        const idx = args.choices[choiceCursor++]!;
        if (idx >= 0 && idx < choice.options.length) return idx;
      }
      return autoResolveChoice(choice, _state, rng);
    },
  });
  renderLife(result, world, args.narrate);
  console.log('\n概要 JSON：');
  console.log(renderSummary(result));
  if (args.out) {
    writeOut(args.out, JSON.stringify(result, null, 2));
    console.error(`\n已写入 ${args.out}`);
  }
}

main();
