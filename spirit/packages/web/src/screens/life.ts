import { hashLife } from '../../../engine/src/engine.ts';
import { NarrativeRenderer, renderLifeLog, type RenderedLogLine } from '../../../engine/src/narrative.ts';
import type { LifeResult } from '../../../engine/src/types.ts';
import { runSegment } from '../game.ts';
import { world, worldMilestones } from '../world.ts';
import { saveGame, loadGame, clearGame, parseSave, downloadSave, type SaveData } from '../save.ts';

const FORM_LABELS: Record<string, string> = {
  human: '凡人',
  animal_yao: '妖（动物系）',
  plant_yao: '妖（植物系）',
  fungus_yao: '妖（菌菇系）',
  spirit_yao: '精怪',
  painted_yao: '妖（器物系）',
};

const DEATH_LABELS: Record<string, string> = {
  health: '油尽灯枯（健康归零）',
  hazard: '命数无常（灾祸）',
  liquality_exhausted: '灵质衰竭',
  space_lixi_lost: '灵质被夺（空间系绑定）',
  'terminal:ascend_trigger': '羽化飞升（修行终点）',
  alive_end: '天年将尽（岁月尽头）',
};

interface LifeUiState {
  seed: number | null;
  picked: number[];
  pointer: number;
  result: LifeResult | null;
  review: boolean;
}

const state: LifeUiState = { seed: null, picked: [], pointer: 0, result: null, review: false };

/** 叙事渲染缓存——同一 LifeResult 只渲染一次（renderLifeLog 本身确定性） */
let renderMemo: { result: LifeResult; lines: RenderedLogLine[] } | null = null;

function narrativeLines(r: LifeResult): RenderedLogLine[] {
  if (renderMemo?.result !== r) {
    renderMemo = { result: r, lines: renderLifeLog(world, r) };
  }
  return renderMemo.lines;
}

/** 出生形态呈现——形态 + 品种 + 生态位 */
function formText(form: string, species?: string, variety?: string, niche?: string): string {
  const label = FORM_LABELS[form] ?? form;
  const detail = [species, variety, niche].filter(Boolean).join(' · ');
  return detail ? `${label} · ${detail}` : label;
}

let importOpen = false;
let shareOpen = false;

function resetFlowUi(): void {
  importOpen = false;
  shareOpen = false;
}

function currentSave(): SaveData | null {
  if (state.seed === null) return null;
  return { v: 1, world: world.name, seed: state.seed, picked: [...state.picked], savedAt: Date.now() };
}

function persist(): void {
  const data = currentSave();
  if (data) saveGame(data);
}

function resumeFromSave(data: SaveData): void {
  state.seed = data.seed;
  state.picked = [...data.picked];
  state.pointer = 0;
  state.review = false;
  state.result = runSegment(world, state.seed, data.picked);
  state.pointer = state.result.log.length;
  persist();
  resetFlowUi();
  rerender();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function drawSeed(): number {
  return Math.floor(Math.random() * 0xffff_ffff);
}

function deathLabel(result: LifeResult): string {
  if (result.state.alive) return '天年将尽（岁月尽头）';
  return DEATH_LABELS[result.deathCause] ?? `亡于「${result.deathCause}」`;
}

function renderLifeScreen(host: HTMLElement): void {
  host.append(buildHeader(), buildBody());
}

function buildHeader(): HTMLElement {
  const head = el('header', 'life-head');
  const h2 = el('h2');
  h2.textContent = '人生游玩 · 罗小黑世界';
  const sub = el('p', 'muted');
  sub.textContent = '抽一签入世，逐步走过岁月，遇到岔路时替 TA 做选择。同 seed + 同抉择序列 = 同一生。';
  head.append(h2, sub);
  return head;
}

function buildBody(): HTMLElement {
  if (state.seed === null || state.result === null) return buildDrawCard();
  const wrap = el('div', 'life-body');
  if (state.review) wrap.append(buildReviewCard());
  else wrap.append(buildBirthCard(), buildLifePanel());
  return wrap;
}

function buildDrawCard(): HTMLElement {
  const card = el('section', 'card');
  const p = el('p');
  p.textContent = '一签一命。签落之处，可能是人、是妖、是精怪——是罗小黑世界里的一段小人生。';
  const btn = el('button', 'primary');
  btn.textContent = '抽一签 · 开始此生';
  btn.addEventListener('click', () => {
    resetFlowUi();
    state.seed = drawSeed();
    state.picked = [];
    state.pointer = 0;
    state.review = false;
    state.result = runSegment(world, state.seed, state.picked);
    persist();
    rerender();
  });
  card.append(p, btn);
  const saved = loadGame();
  if (saved && saved.world === world.name) {
    const resume = el('button');
    resume.textContent = `继续上局 · 命签 #${saved.seed}（已替 TA 抉择 ${saved.picked.length} 次）`;
    resume.addEventListener('click', () => {
      resumeFromSave(saved);
    });
    card.append(resume);
  } else if (saved) {
    clearGame();
  }
  const importBtn = el('button');
  importBtn.textContent = '导入存档…';
  importBtn.addEventListener('click', () => {
    importOpen = !importOpen;
    rerender();
  });
  card.append(importBtn);
  if (importOpen) card.append(buildImportBox());
  return card;
}

function buildImportBox(): HTMLElement {
  const box = el('div', 'import-box');
  const tip = el('p', 'muted');
  tip.textContent = '粘贴存档 JSON（含 seed 与抉择记录），换设备可携带同一段人生。';
  const ta = el('textarea');
  ta.placeholder = '{"v":1,"world":"罗小黑世界","seed":42,"picked":[0,1],...}';
  const err = el('p', 'import-error');
  err.hidden = true;
  const actions = el('div', 'actions');
  const confirm = el('button', 'primary');
  confirm.textContent = '解析并续档';
  confirm.addEventListener('click', () => {
    try {
      const data = parseSave(ta.value);
      if (data.world !== world.name) {
        throw new Error(`存档属于世界「${data.world}」，与当前世界「${world.name}」不符`);
      }
      importOpen = false;
      resumeFromSave(data);
    } catch (e) {
      err.textContent = e instanceof Error ? e.message : String(e);
      err.hidden = false;
    }
  });
  const cancel = el('button');
  cancel.textContent = '取消';
  cancel.addEventListener('click', () => {
    importOpen = false;
    rerender();
  });
  actions.append(confirm, cancel);
  box.append(tip, ta, err, actions);
  return box;
}

function buildBirthCard(): HTMLElement {
  const card = el('section', 'card');
  const h3 = el('h3');
  h3.textContent = '出生';
  card.append(h3);
  const b = state.result?.birth;
  if (!b) return card;
  const rows: Array<[string, string]> = [
    ['形态', formText(b.form, b.species, b.variety, b.niche)],
    ['降生之地', `${b.region} · ${b.era}`],
  ];
  if (b.lixi) rows.push(['灵系显性', b.dualLixi ? `${b.lixi}（双灵质）` : b.lixi]);
  if (b.liqiManifest) rows.push(['灵气感应', '已显']);
  if (b.cultivator) rows.push(['修行机缘', '已开启']);
  if (b.reincarnatedSoul) rows.push(['异兆', '转世魂灵']);
  rows.push(['命签', `#${state.seed}`]);
  const table = el('table', 'kv');
  for (const [k, v] of rows) {
    const tr = el('tr');
    const td1 = el('td', 'k');
    td1.textContent = k;
    const td2 = el('td');
    td2.textContent = v;
    tr.append(td1, td2);
    table.append(tr);
  }
  card.append(table);
  if (b.preBirthLog.length > 0) {
    const pre = el('ul', 'pre-birth');
    for (const entry of b.preBirthLog) {
      const li = el('li');
      li.textContent = entry.label;
      pre.append(li);
    }
    card.append(pre);
  }
  return card;
}

function buildLifePanel(): HTMLElement {
  const r = state.result!;
  const panel = el('section', 'card');
  panel.append(buildAttrsBar(r), buildLogStream(r), buildActionArea(r));
  return panel;
}

function buildAttrsBar(r: LifeResult): HTMLElement {
  const bar = el('div', 'attrs');
  const pairs: Array<[string, number | string]> = [
    ['岁', r.state.tick],
    ['健康', Math.round(r.state.attrs['health'] ?? 0)],
    ['灵质', Math.round(r.state.attrs['liquality'] ?? 0)],
    ['灵力', Math.round(r.state.attrs['spirit'] ?? 0)],
  ];
  const tier = r.state.flags.find((f) => f.startsWith('tier:'));
  if (tier) pairs.push(['阶位', tier.slice(5)]);
  for (const [k, v] of pairs) {
    const chip = el('span', 'chip');
    chip.textContent = `${k} ${v}`;
    bar.append(chip);
  }
  return bar;
}

function buildLogStream(r: LifeResult): HTMLElement {
  const stream = el('div', 'log-stream');
  const shown = narrativeLines(r).slice(0, state.pointer);
  for (const line of shown) {
    const row = el('div', 'log-line');
    if (worldMilestones.includes(line.eventId)) row.classList.add('milestone');
    if (line.isPrompt) row.classList.add('prompt');
    const age = el('span', 'age');
    age.textContent = `${line.tick}岁`;
    const text = el('span');
    text.textContent = line.isPrompt ? `❈ ${line.text}` : line.text;
    if (line.picked) {
      const pick = el('span', 'picked');
      pick.textContent = `（抉择：${line.picked}）`;
      text.append(pick);
    }
    row.append(age, text);
    if (line.caption) {
      const cap = el('span', 'milestone-caption');
      cap.textContent = `〔${line.caption}〕`;
      row.append(cap);
    }
    stream.append(row);
  }
  const remain = r.log.length - state.pointer;
  if (remain > 0) {
    const more = el('div', 'muted');
    more.textContent = `……岁月长河还有 ${remain} 段未展开`;
    stream.append(more);
  }
  return stream;
}

function buildActionArea(r: LifeResult): HTMLElement {
  const area = el('div', 'actions');
  const atEnd = state.pointer >= r.log.length;
  if (atEnd && r.pausedChoice) {
    area.append(buildChoiceCard(r), buildSaveButtons());
    return area;
  }
  if (atEnd) {
    area.append(buildEndCard(r));
    return area;
  }
  const btn = el('button', 'primary');
  btn.textContent = '走过一段岁月';
  btn.addEventListener('click', () => {
    state.pointer = Math.min(state.pointer + 10, r.log.length);
    rerender();
  });
  area.append(btn);
  const skip = el('button');
  skip.textContent = '直抵当下';
  skip.addEventListener('click', () => {
    state.pointer = r.log.length;
    rerender();
  });
  area.append(skip, buildSaveButtons());
  return area;
}

function buildSaveButtons(): HTMLElement {
  const wrap = el('div', 'save-actions');
  const exportBtn = el('button');
  exportBtn.textContent = '导出存档';
  exportBtn.addEventListener('click', () => {
    const data = currentSave();
    if (data) downloadSave(data);
  });
  wrap.append(exportBtn);
  return wrap;
}

function buildChoiceCard(r: LifeResult): HTMLElement {
  const choice = r.pausedChoice!;
  const card = el('div', 'choice-card');
  const prompt = el('p', 'choice-prompt');
  // 抉择点优先用叙事库 prompt（含槽位），缺失时回退世界原文
  const narratedPrompt = r.pausedEventId
    ? new NarrativeRenderer(world, r.birth).renderPrompt(r.pausedEventId, r.state)
    : undefined;
  prompt.textContent = narratedPrompt ?? choice.prompt;
  card.append(prompt);
  choice.options.forEach((opt, idx) => {
    const btn = el('button', 'choice-opt');
    const label = el('span');
    label.textContent = opt.label;
    btn.append(label);
    if (opt.desc) {
      const desc = el('span', 'muted');
      desc.textContent = opt.desc;
      btn.append(desc);
    }
    btn.addEventListener('click', () => {
      state.picked.push(idx);
      state.result = runSegment(world, state.seed!, state.picked);
      persist();
      rerender();
    });
    card.append(btn);
  });
  return card;
}

function buildEndCard(r: LifeResult): HTMLElement {
  clearGame();
  const card = el('div', 'end-card');
  const title = el('h3');
  title.textContent = '此生落幕';
  const info = el('p');
  const finalTick = r.deathTick ?? r.state.tick;
  info.textContent = `${deathLabel(r)} · 终年 ${finalTick} · 人生指纹 ${hashLife(r)}`;
  const actions = el('div', 'actions');
  const reviewBtn = el('button', 'primary');
  reviewBtn.textContent = '回顾一生';
  reviewBtn.addEventListener('click', () => {
    state.review = true;
    rerender();
  });
  const shareBtn = el('button');
  shareBtn.textContent = '分享此生';
  shareBtn.addEventListener('click', () => {
    shareOpen = !shareOpen;
    rerender();
  });
  const redoBtn = el('button');
  redoBtn.textContent = '重开此生（同签重掷）';
  redoBtn.addEventListener('click', () => {
    state.picked = [];
    state.pointer = 0;
    state.review = false;
    state.seed = drawSeed();
    state.result = runSegment(world, state.seed, state.picked);
    persist();
    resetFlowUi();
    rerender();
  });
  const newBtn = el('button');
  newBtn.textContent = '另抽一签';
  newBtn.addEventListener('click', () => {
    state.seed = null;
    state.result = null;
    state.picked = [];
    state.pointer = 0;
    state.review = false;
    resetFlowUi();
    clearGame();
    rerender();
  });
  actions.append(reviewBtn, shareBtn, redoBtn, newBtn);
  card.append(title, info, actions);
  if (shareOpen) card.append(buildShareCard(r));
  return card;
}

function buildShareText(r: LifeResult): string {
  const lines: string[] = ['【生灵引 · 罗小黑世界】一签一命'];
  const b = r.birth;
  if (b) {
    lines.push(`命签 #${state.seed} · ${formText(b.form, b.species, b.variety, b.niche)}`);
    lines.push(`生于 ${b.region} · ${b.era}`);
  }
  const finalTick = r.deathTick ?? r.state.tick;
  lines.push(`终年 ${finalTick} · ${deathLabel(r)}`);
  lines.push(`人生指纹 ${hashLife(r)} · 替 TA 抉择 ${state.picked.length} 次`);
  lines.push('——');
  const data = currentSave();
  if (data) {
    lines.push('复现此生（存档 JSON，导入即可重走同一条人生）：');
    lines.push(JSON.stringify({ v: data.v, world: data.world, seed: data.seed, picked: data.picked }));
  }
  lines.push('同 seed + 同抉择序列 = 同一生 · 生灵引 · 客户端生成 · 零上传');
  return lines.join('\n');
}

function buildShareCard(r: LifeResult): HTMLElement {
  const box = el('div', 'import-box');
  const text = buildShareText(r);
  const pre = el('pre', 'share-text');
  pre.textContent = text;
  const actions = el('div', 'actions');
  const msg = el('span', 'muted');
  const copy = el('button', 'primary');
  copy.textContent = '复制文本';
  copy.addEventListener('click', () => {
    void navigator.clipboard
      .writeText(text)
      .then(() => {
        msg.textContent = '已复制到剪贴板';
      })
      .catch(() => {
        msg.textContent = '复制失败（浏览器限制），可手动选中文本';
      });
  });
  const dl = el('button');
  dl.textContent = '下载 .txt';
  dl.addEventListener('click', () => {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shenglingyin-life-${state.seed}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
  actions.append(copy, dl, msg);
  box.append(pre, actions);
  return box;
}

function buildReviewCard(): HTMLElement {
  const r = state.result!;
  const card = el('section', 'card');
  const h3 = el('h3');
  h3.textContent = `一生回顾 · 终年 ${r.deathTick ?? r.state.tick} · ${deathLabel(r)}`;
  card.append(h3);
  const b = r.birth;
  if (b) {
    const sub = el('p', 'muted');
    sub.textContent = `生于 ${b.region} · ${b.era}，${formText(b.form, b.species, b.variety, b.niche)}，共历 ${r.log.length} 段岁月`;
    card.append(sub);
  }
  const decades = new Map<number, string[]>();
  for (const line of narrativeLines(r)) {
    const dec = Math.floor(line.tick / 10) * 10;
    let text = line.isPrompt ? `❈ ${line.text}` : line.text;
    if (worldMilestones.includes(line.eventId)) text = `★ ${text}`;
    if (line.caption) text += `〔${line.caption}〕`;
    if (line.picked) text += `（抉择：${line.picked}）`;
    const list = decades.get(dec) ?? [];
    list.push(`${line.tick}岁 ${text}`);
    decades.set(dec, list);
  }
  for (const dec of [...decades.keys()].sort((a, b2) => a - b2)) {
    const h4 = el('h4');
    h4.textContent = dec === 0 ? '童年（0-9 岁）' : `${dec} 岁段`;
    const ul = el('ul', 'review-list');
    for (const line of decades.get(dec)!) {
      const li = el('li');
      li.textContent = line;
      ul.append(li);
    }
    card.append(h4, ul);
  }
  const back = el('button');
  back.textContent = '返回终局';
  back.addEventListener('click', () => {
    state.review = false;
    rerender();
  });
  card.append(back);
  return card;
}

function rerender(): void {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) return;
  app.replaceChildren();
  renderLifeScreen(app);
}

export { renderLifeScreen, FORM_LABELS, DEATH_LABELS };
