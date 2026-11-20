import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { loadWorldFile, loadWorldPack } from '../../dsl/src/index.ts';
import {
  autoResolveChoice,
  createRng,
  NarrativeRenderer,
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
      console.log('用法: node main.ts [--world <path>] [--seed <n>] [--auto] [--choice <n>]... [--out <path>]');
      console.log('       node main.ts [--world <path>] --batch <n> [--format json|csv] [--out <path>]');
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
  const renderer = narrate ? new NarrativeRenderer(world, result.birth) : undefined;
  // 叙事渲染用独立 rng（从 seed 派生），不影响人生掷骰铁律
  const narrRng = narrate ? createRng((result.seed ^ 0x5a5a5a5a) >>> 0) : undefined;
  for (const e of result.log) {
    const changes = e.effects
      ? ' ' +
        Object.entries(e.effects)
          .map(([k, v]) => `${k}${v > 0 ? '+' : ''}${v}`)
          .join(' ')
      : '';
    const choiceNote = e.choice ? `（抉择：${e.choice.picked}）` : '';
    if (renderer && narrRng) {
      const narrated = renderer.renderEvent(e.eventId, result.state, narrRng);
      const prompt = renderer.renderPrompt(e.eventId, result.state);
      if (prompt) {
        console.log(`  第 ${String(e.tick).padStart(2)} 年 | ❈ ${prompt}`);
        console.log(`          → ${e.choice?.picked ?? ''}${changes}`);
      } else if (narrated) {
        console.log(`  第 ${String(e.tick).padStart(2)} 年 | ${narrated}${changes}${choiceNote}`);
      } else {
        console.log(`  第 ${String(e.tick).padStart(2)} 年 | ${e.label}${changes}${choiceNote}`);
      }
    } else {
      console.log(`  第 ${String(e.tick).padStart(2)} 年 | ${e.label}${changes}${choiceNote}`);
    }
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

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const worldPath = args.world;
  // 若 world.yaml 同目录有 narratives.yaml，自动加载（loadWorldPack 双文件）
  const worldDir = worldPath.includes('/') || worldPath.includes('\\')
    ? worldPath.replace(/[\\/][^\\/]+$/, '')
    : '.';
  const world = worldPath.endsWith('.yaml') && !worldPath.endsWith('/world.yaml')
    ? loadWorldFile(worldPath)
    : loadWorldPack(worldDir);
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
