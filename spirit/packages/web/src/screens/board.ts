import { statsToCsv } from '../../../engine/src/batch.ts';
import type { BatchStats } from '../../../engine/src/types.ts';
import { worldYaml } from '../world.ts';
import { FORM_LABELS, DEATH_LABELS } from './life.ts';

interface ProgressMsg {
  type: 'progress';
  done: number;
  total: number;
}

interface DoneMsg {
  type: 'done';
  stats: BatchStats;
}

type WorkerMsg = ProgressMsg | DoneMsg;

interface BoardUiState {
  running: boolean;
  done: number;
  total: number;
  stats: BatchStats | null;
  elapsedMs: number;
  error: string | null;
}

const state: BoardUiState = { running: false, done: 0, total: 0, stats: null, elapsedMs: 0, error: null };

const RUN_SIZES: Array<[number, string]> = [
  [1_000, '1 千条 · 快速冒烟'],
  [10_000, '1 万条 · 常规统计'],
  [100_000, '10 万条 · DoD 主角验证'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function renderBoardScreen(host: HTMLElement): void {
  const head = el('header', 'life-head');
  const h2 = el('h2');
  h2.textContent = '批量看板 · 涌现统计';
  const sub = el('p', 'muted');
  sub.textContent = 'Web Worker 后台分块运行，主线程不卡顿。十万条人生，看千万人中的那一个。';
  head.append(h2, sub);
  host.append(head, buildControlCard());
}

function buildControlCard(): HTMLElement {
  const card = el('section', 'card');
  if (state.running) {
    card.append(buildProgressBar(), buildProgressText());
    return card;
  }
  const p = el('p');
  p.textContent = state.stats ? '再跑一轮：换一批 seed，看统计是否稳定（铁律①批量版）。' : '选择跑量，开始在后台批量模拟人生。';
  card.append(p);
  const row = el('div', 'actions');
  for (const [count, label] of RUN_SIZES) {
    const btn = el('button', 'primary');
    btn.textContent = label;
    btn.addEventListener('click', () => startRun(count));
    row.append(btn);
  }
  card.append(row);
  if (state.error) {
    const err = el('p', 'import-error');
    err.textContent = state.error;
    card.append(err);
  }
  if (state.stats) card.append(buildStatsCard(state.stats));
  return card;
}

function buildProgressBar(): HTMLElement {
  const track = el('div', 'progress-track');
  const fill = el('div', 'progress-fill');
  const pct = state.total > 0 ? Math.floor((state.done / state.total) * 100) : 0;
  fill.style.width = `${pct}%`;
  track.append(fill);
  return track;
}

function buildProgressText(): HTMLElement {
  const p = el('p', 'muted');
  const pct = state.total > 0 ? Math.floor((state.done / state.total) * 100) : 0;
  p.textContent = `已跑 ${state.done.toLocaleString()} / ${state.total.toLocaleString()} 条（${pct}%）——Worker 后台运行中，可切回人生屏继续游玩`;
  return p;
}

function startRun(count: number): void {
  state.running = true;
  state.done = 0;
  state.total = count;
  state.stats = null;
  state.error = null;
  const startAt = Date.now();
  rerender();
  const worker = new Worker(new URL('../batch.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<WorkerMsg>) => {
    const msg = ev.data;
    if (msg.type === 'progress') {
      state.done = msg.done;
      state.total = msg.total;
      rerender();
      return;
    }
    state.stats = msg.stats;
    state.elapsedMs = Date.now() - startAt;
    state.running = false;
    worker.terminate();
    rerender();
  };
  worker.onerror = () => {
    state.running = false;
    state.error = 'Worker 运行失败（浏览器或环境限制）';
    worker.terminate();
    rerender();
  };
  worker.postMessage({ yaml: worldYaml, count, seedStart: 0, chunkSize: 1_000 });
}

function buildStatsCard(stats: BatchStats): HTMLElement {
  const card = el('section', 'card');
  const h3 = el('h3');
  h3.textContent = `涌现统计 · ${stats.worldName} · ${stats.count.toLocaleString()} 条人生`;
  card.append(h3);
  const chips = el('div', 'attrs');
  const pairs: Array<[string, string]> = [
    ['条数', stats.count.toLocaleString()],
    ['修行者率', `${(stats.cultivatorRate * 100).toFixed(1)}%`],
    ['平均终年', stats.avgDeathTick.toFixed(1)],
    ['耗时', `${(state.elapsedMs / 1000).toFixed(1)}s`],
  ];
  for (const [k, v] of pairs) {
    const chip = el('span', 'chip');
    chip.textContent = `${k} ${v}`;
    chips.append(chip);
  }
  card.append(chips, buildDistSection('形态分布', stats.formDist, FORM_LABELS));
  if (Object.keys(stats.lixiDist).length > 0) {
    card.append(buildDistSection('灵系分布（显性者）', stats.lixiDist, {}));
  }
  card.append(
    buildDistSection('死因分布', stats.deathCauseDist, DEATH_LABELS),
  );
  if (Object.keys(stats.tierDist).length > 0) {
    card.append(buildDistSection('灵力阶梯（修行者）', stats.tierDist, {}));
  }
  if (Object.keys(stats.terminalDist).length > 0) {
    card.append(buildDistSection('终点事件触发', stats.terminalDist, {}));
  }
  const actions = el('div', 'actions');
  const csvBtn = el('button');
  csvBtn.textContent = '导出 CSV';
  csvBtn.addEventListener('click', () => {
    const blob = new Blob([statsToCsv(stats)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shenglingyin-batch-${stats.count}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
  actions.append(csvBtn);
  card.append(actions);
  return card;
}

function buildDistSection(title: string, dist: Record<string, number>, labels: Record<string, string>): HTMLElement {
  const wrap = el('div', 'dist-section');
  const h4 = el('h4');
  h4.textContent = title;
  wrap.append(h4);
  const entries = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  const max = entries[0]?.[1] ?? 1;
  for (const [key, v] of entries) {
    const row = el('div', 'bar-row');
    const label = el('span', 'bar-label');
    label.textContent = labels[key] ?? key;
    const track = el('div', 'bar-track');
    const fill = el('div', 'bar-fill');
    fill.style.width = `${(v / max) * 100}%`;
    track.append(fill);
    const val = el('span', 'bar-val');
    const pct = total > 0 ? ((v / total) * 100).toFixed(1) : '0.0';
    val.textContent = `${v.toLocaleString()}（${pct}%）`;
    row.append(label, track, val);
    wrap.append(row);
  }
  return wrap;
}

function rerender(): void {
  const active = document.querySelector<HTMLElement>('#nav button.active');
  if (active?.dataset.screen !== 'board') return;
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) return;
  app.replaceChildren();
  renderBoardScreen(app);
}

export { renderBoardScreen };
