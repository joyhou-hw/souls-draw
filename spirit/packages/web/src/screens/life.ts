import { hashLife } from '../../../engine/src/engine.ts';
import { NarrativeRenderer, renderLifeLog, type RenderedLogLine } from '../../../engine/src/narrative.ts';
import type { BirthOutcome, LifeResult } from '../../../engine/src/types.ts';
import { createRng } from '../../../engine/src/rng.ts';
import { runSegment } from '../game.ts';
import { world, worldMilestones } from '../world.ts';
import { saveGame, loadGame, clearGame, parseSave, downloadSave, type SaveData } from '../save.ts';
import { composeScene, deriveParams, normalizePlace, normalizeEra } from '../imaging/composer.ts';

const FORM_LABELS: Record<string, string> = {
  human: '凡人',
  animal_yao: '兽妖',
  plant_yao: '草木妖',
  fungus_yao: '菌蕈妖',
  spirit_yao: '游灵',
  painted_yao: '器灵',
};

const DEATH_LABELS: Record<string, string> = {
  health: '油尽灯枯（健康归零）',
  hazard: '命数无常（灾祸）',
  liquality_exhausted: '灵质衰竭',
  space_lixi_lost: '灵质被夺（空间系绑定）',
  'terminal:ascend_trigger': '羽化飞升（修行终点）',
  alive_end: '天年将尽（岁月尽头）',
};

const LIXI_LABELS: Record<string, string> = {
  yuling: '御灵',
  shengling: '生灵',
  suoyu: '锁御',
  xinling: '信灵',
  zaowu: '造物',
  space: '宇隙',
  none: '无形',
};

const FATE_LABELS: Record<string, string> = {
  drift: '如游丝一缕，随风漂荡',
  liqi_doll: '被灵力塑作人形，徘徊无主',
  absorbed: '几被外物吞纳，险得留存',
  natural_condense: '依天地自然之机，缓慢凝聚',
};

const ATTR_LABELS: Record<string, string> = {
  health: '生命',
  liquality: '灵质',
  spirit: '灵力',
  wealth: '财帛',
};

const SURNAMES = [
  '沈', '陆', '顾', '苏', '谢', '萧', '林', '白', '温', '裴',
  '柳', '楚', '云', '洛', '江', '安', '叶', '许', '岑', '闻',
];

const GIVEN_MALE = [
  '临渊', '照雪', '无咎', '清商', '砚秋', '停云', '既明', '怀瑾',
  '听澜', '归鸿', '见微', '凌霄', '扶光', '辞镜', '寒川',
];

const GIVEN_FEMALE = [
  '溪月', '照花', '疏影', '青黛', '聆风', '栖梧', '未晞', '鹿鸣',
  '沐晴', '晚照', '含章', '云岫', '棠梨', '若初', '清欢',
];

const LOCALITY_BY_REGION: Record<string, string[]> = {
  forest: ['幽篁谷', '白鹿岭', '松涛原', '青崖涧', '听风坡'],
  city: ['长街', '鼓楼巷', '旧城门', '青石里', '灯市口'],
  guild_land: ['借灵院', '西厢', '青石坊', '藏经廊', '练法坪'],
  hermit_island: ['听涛崖', '望海台', '云栈', '观潮亭', '枕石滩'],
};

interface LifeUiState {
  seed: number | null;
  picked: number[];
  pointer: number;
  result: LifeResult | null;
  review: boolean;
  drawing: boolean;
  autoPlay: boolean;
  speedIdx: number;
  starredLines: Set<number>;
  /** 抽签过渡动画阶段：0=无, 1=跳动中, 2=卡片展示 */
  drawPhase: number;
}

const state: LifeUiState = {
  seed: null, picked: [], pointer: 0, result: null, review: false, drawing: false,
  autoPlay: false, speedIdx: 0, starredLines: new Set(), drawPhase: 0,
};

/** 速度档位：标签 → 间隔毫秒（对标 80亿分之一 1x~8x） */
const SPEED_LABELS: Array<[string, number]> = [
  ['1×', 5000],
  ['2×', 2500],
  ['4×', 1200],
  ['8×', 600],
];

/** 无限纪元年——出生时为无限418年 */
const BIRTH_YEAR = 418;
const ERA_NAME = '无限';

/** 根据 tick 计算日历年 */
function calendarYear(tick: number): string {
  return `${ERA_NAME}${BIRTH_YEAR + tick}年`;
}

/** 日志行年龄标注——出生前/降生/岁数 */
function ageLabel(tick: number): string {
  if (tick < 0) return '入世前';
  if (tick === 0) return '降生';
  return `${tick}岁`;
}

let autoTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoTimer(): void {
  if (autoTimer !== null) { clearTimeout(autoTimer); autoTimer = null; }
}

/** 根据当前条目文本长度计算延迟：基础间隔 + 文本长度因子 + 随机延迟 */
function calcDelay(r: LifeResult): number {
  const [, baseMs] = SPEED_LABELS[state.speedIdx]!;
  const lines = narrativeLines(r);
  const curLine = lines[state.pointer];
  // 文本长度因子：每 10 字加 100ms，让长叙事读更久
  const textLen = curLine?.text.length ?? 0;
  const textDelay = Math.floor(textLen / 10) * 100;
  // 随机延迟：0~500ms，让节奏不死板
  const randomDelay = Math.floor(Math.random() * 500);
  return baseMs + textDelay + randomDelay;
}

/** 自动播放单步：推进1行，遇抉择 prompt 或末尾自动暂停 */
function tickAdvance(r: LifeResult): void {
  const lines = narrativeLines(r);
  if (state.pointer >= lines.length) {
    state.autoPlay = false;
    clearAutoTimer();
    rerender();
    return;
  }
  state.pointer++;
  if (lines[state.pointer - 1]?.isPrompt) {
    state.autoPlay = false;
    clearAutoTimer();
    rerender();
    return;
  }
  rerender();
  // 链式调度下一次——延迟根据新条目内容变化
  if (state.autoPlay) {
    autoTimer = setTimeout(() => tickAdvance(r), calcDelay(r));
  }
}

/** 叙事渲染缓存——同一 LifeResult 只渲染一次（renderLifeLog 本身确定性） */
let renderMemo: { result: LifeResult; lines: RenderedLogLine[] } | null = null;

function narrativeLines(r: LifeResult): RenderedLogLine[] {
  if (renderMemo?.result !== r) {
    renderMemo = { result: r, lines: renderLifeLog(world, r) };
  }
  return renderMemo.lines;
}

/** 查叙事槽位映射，缺省回退原始枚举值 */
function slotText(slot: string, key: string): string {
  return world.narratives?.slots?.[slot]?.[key] ?? key;
}

function lixiText(lixi: string, dual: boolean): string {
  const label = LIXI_LABELS[lixi] ?? lixi;
  return dual ? `${label}（双灵相济）` : label;
}

/** 属性效果 → 中文提示（省略为 0 的项） */
function formatEffects(effects: Record<string, number> | undefined): string {
  if (!effects) return '';
  const parts: string[] = [];
  for (const [key, val] of Object.entries(effects)) {
    if (!val) continue;
    const label = ATTR_LABELS[key] ?? key;
    parts.push(`${label}${val > 0 ? '+' : ''}${val}`);
  }
  return parts.join(' · ');
}

interface BirthIdentity {
  name: string;
  gender: string;
  birthplace: string;
}

let identityMemo: { seed: number; identity: BirthIdentity } | null = null;

/** 由 seed 确定性地派生姓名、性别与出生地名（与 runLife 掷骰隔离） */
function identityFor(birth: BirthOutcome): BirthIdentity {
  const seed = state.seed ?? 0;
  if (identityMemo?.seed === seed) return identityMemo.identity;
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  const gender = rng.pick(['男', '女']);
  const surname = rng.pick(SURNAMES);
  const given = gender === '男' ? rng.pick(GIVEN_MALE) : rng.pick(GIVEN_FEMALE);
  const place = slotText('place', birth.region);
  const locality = rng.pick(LOCALITY_BY_REGION[birth.region] ?? ['无名之地']);
  const era = slotText('era', birth.era);
  const identity: BirthIdentity = {
    name: `${surname}${given}`,
    gender,
    birthplace: `${place} · ${locality} · ${era}`,
  };
  identityMemo = { seed, identity };
  return identity;
}

/** 出生前链 → 诗意中文呈现（隐藏开发者门控文本） */
function preBirthText(b: BirthOutcome, eventId: string, label: string, id: BirthIdentity): string {
  const place = slotText('place', b.region);
  const era = slotText('era', b.era);
  switch (eventId) {
    case 'pre_birth/human_line':
      return b.reincarnatedSoul
        ? `一缕前世魂灵凝而不散，携旧忆投胎于${place}`
        : `一缕魂灵投胎于${place}（${era}）`;
    case 'pre_birth/shengling':
      return label.includes('顺遂')
        ? `生灵于${place}顺遂凝聚，灵气充盈`
        : `生灵于${place}凝聚坎坷，灵气稀薄，漂泊辗转方成`;
    case 'pre_birth/jingling': {
      const fate = label.slice('精灵期（无实体）：'.length);
      return `精灵期（无实体）：${FATE_LABELS[fate] ?? fate}`;
    }
    case 'pre_birth/condense':
      if (b.species) {
        const s = slotText('species', b.species);
        const v = b.variety ? `（${slotText('variety', b.variety)}）` : '';
        return `凝形为${s}${v}之相，结合物质灵降生`;
      }
      return `凝形为${FORM_LABELS[b.form] ?? b.form}，结合物质灵降生`;
    case 'birth':
      return `${id.name}自此入世，降生于${id.birthplace}`;
    default:
      return label;
  }
}

/** 出生形态呈现——形态 + 品种 + 生态位（全部中文化） */
function formText(form: string, species?: string, variety?: string, niche?: string): string {
  const label = FORM_LABELS[form] ?? form;
  const detail = [
    species ? slotText('species', species) : undefined,
    variety ? slotText('variety', variety) : undefined,
    niche ? slotText('niche', niche) : undefined,
  ].filter(Boolean).join(' · ');
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
  clearAutoTimer();
  state.seed = data.seed;
  state.picked = [...data.picked];
  state.pointer = 0;
  state.review = false;
  state.autoPlay = false;
  state.starredLines.clear();
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

// ═══════════════════════════════════════════════
// 场景渲染入口
// ═══════════════════════════════════════════════

function renderLifeScreen(host: HTMLElement): void {
  host.append(buildScene());
}

/** 根据当前状态确定场景类型并构建 */
function buildScene(): HTMLElement {
  // 命签抽选动画
  if (state.drawing) return buildDrawAnim();

  // 未抽签 → 抽签场景
  if (state.seed === null || state.result === null) return buildDrawScene();

  // 回顾态 → 回顾场景
  if (state.review) return buildReviewScene();

  const r = state.result;
  const atEnd = state.pointer >= r.log.length;

  // 抉择暂停 → 抉择场景
  if (atEnd && r.pausedChoice) {
    if (state.autoPlay) { state.autoPlay = false; clearAutoTimer(); }
    return buildChoiceScene(r);
  }

  // 终局 → 终局场景
  if (atEnd) {
    if (state.autoPlay) { state.autoPlay = false; clearAutoTimer(); }
    return buildEndScene(r);
  }

  // 推进中 → 推进场景（含出生卡 + 日志）
  return buildLifeScene(r);
}

// ═══════════════════════════════════════════════
// 命签抽选动画——名字/性别/形态/降生地跳动 → 生灵卡片 → 点击"引"
// ═══════════════════════════════════════════════

let drawAnimTimer: ReturnType<typeof setTimeout> | null = null;
let drawAnimStep = 0;

const DRAW_ANIM_STEPS = ['名字', '性别', '形态', '降生地'] as const;

/** 跳动用的随机池 */
function shufflePool(arr: string[]): string[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function buildDrawAnim(): HTMLElement {
  const anim = el('section', 'draw-anim');
  drawAnimStep = 0;

  const b = state.result?.birth;
  if (!b) {
    // 异常回退：直接进入人生场景
    state.drawing = false;
    state.autoPlay = true;
    setTimeout(() => { rerender(); if (state.result) startAutoPlay(state.result); }, 100);
    return anim;
  }
  const id = identityFor(b);

  // 跳动容器
  const rollArea = el('div', 'roll-area');
  // 簽印章
  const seal = el('div', 'seal');
  seal.textContent = '簽';
  rollArea.append(seal);

  // 四个跳动字段
  const fields: Array<{ label: string; pool: string[]; final: string }> = [
    { label: '名字', pool: shufflePool([...SURNAMES, ...GIVEN_MALE, ...GIVEN_FEMALE]), final: id.name },
    { label: '性别', pool: ['男', '女', '男', '女'], final: id.gender },
    { label: '形态', pool: Object.values(FORM_LABELS), final: FORM_LABELS[b.form] ?? b.form },
    { label: '降生地', pool: Object.values(LOCALITY_BY_REGION).flat(), final: id.birthplace },
  ];

  for (const f of fields) {
    const row = el('div', 'roll-field');
    row.dataset.label = f.label;
    row.dataset.final = f.final;
    // 池中随机抽取，跳到最终值
    let poolIdx = 0;
    const label = el('span', 'roll-label');
    label.textContent = f.label;
    const val = el('span', 'roll-val');
    val.textContent = f.pool[0]!;
    row.append(label, val);
    rollArea.append(row);
  }
  anim.append(rollArea);

  // 逐字段跳动动画
  let stepDelay = 400;
  function animateStep(): void {
    if (drawAnimStep >= fields.length) {
      // 全部跳动完毕 → 显示生灵卡片
      drawAnimTimer = setTimeout(() => showSoulCard(), 600);
      return;
    }
    const field = fields[drawAnimStep]!;
    const rows = rollArea.querySelectorAll('.roll-field');
    const row = rows[drawAnimStep]!;
    const valEl = row.querySelector('.roll-val')!;
    let flickCount = 0;
    const flickInterval = setInterval(() => {
      if (flickCount >= 6) {
        clearInterval(flickInterval);
        valEl.textContent = field.final;
        row.classList.add('roll-done');
        drawAnimStep++;
        drawAnimTimer = setTimeout(animateStep, stepDelay);
        return;
      }
      valEl.textContent = field.pool[Math.floor(Math.random() * field.pool.length)]!;
      flickCount++;
    }, 80);
  }
  drawAnimTimer = setTimeout(animateStep, 500);

  /** 显示生灵卡片 + "引"按钮 */
  function showSoulCard(): void {
    const birth = state.result?.birth;
    if (!birth) return;
    state.drawPhase = 2;
    const card = el('div', 'soul-card');
    // 场景图
    const imgWrap = buildSceneImage(state.result!);
    card.append(imgWrap);
    // 命签
    const seal = el('div', 'soul-seal');
    seal.textContent = `命签 #${state.seed}`;
    card.append(seal);
    // 姓名
    const nameEl = el('h2', 'soul-name');
    nameEl.textContent = id.name;
    card.append(nameEl);
    // 信息表
    const infoRows: Array<[string, string]> = [
      ['性别', id.gender],
      ['形态', formText(birth.form, birth.species, birth.variety, birth.niche)],
      ['降生之地', id.birthplace],
    ];
    if (birth.lixi) infoRows.push(['灵系显性', lixiText(birth.lixi, birth.dualLixi)]);
    if (birth.liqiManifest) infoRows.push(['灵气感应', '已显']);
    if (birth.cultivator) infoRows.push(['修行机缘', '已开启']);
    if (birth.reincarnatedSoul) infoRows.push(['异兆', '转世魂灵']);
    const table = el('table', 'soul-table');
    for (const [k, v] of infoRows) {
      const tr = el('tr');
      const td1 = el('td', 'k');
      td1.textContent = k;
      const td2 = el('td');
      td2.textContent = v;
      tr.append(td1, td2);
      table.append(tr);
    }
    card.append(table);
    // "引"按钮
    const enterBtn = el('button', 'primary soul-enter');
    enterBtn.textContent = '引 · 开启此生';
    enterBtn.addEventListener('click', () => {
      state.drawing = false;
      state.drawPhase = 0;
      state.autoPlay = true;
      rerender();
      if (state.result) startAutoPlay(state.result);
    });
    card.append(enterBtn);
    // 替换跳动区域
    const oldRoll = anim.querySelector('.roll-area');
    if (oldRoll) oldRoll.replaceWith(card);
  }

  return anim;
}

// ═══════════════════════════════════════════════
// 抽签场景
// ═══════════════════════════════════════════════

function buildDrawScene(): HTMLElement {
  const scene = el('section', 'scene draw-scene');
  const title = el('h2', 'draw-title');
  title.textContent = "Souls' Draw";
  const sub = el('p', 'draw-subtitle');
  sub.textContent = '生 · 灵 · 引';
  scene.append(title, sub);

  const desc = el('p', 'draw-desc');
  desc.textContent = '签落之处，可能是人、是妖、是精怪——是罗小黑世界里的一段小人生。';
  scene.append(desc);

  const actions = el('div', 'draw-actions');
  const btn = el('button', 'primary');
  btn.textContent = '抽一签 · 开始此生';
  btn.addEventListener('click', () => {
    resetFlowUi();
    clearAutoTimer();
    state.seed = drawSeed();
    state.picked = [];
    state.pointer = 0;
    state.review = false;
    state.autoPlay = false;
    state.starredLines.clear();
    state.result = runSegment(world, state.seed, state.picked);
    persist();
    // 触发命签抽选动画，动画结束后自动进入人生场景
    state.drawing = true;
    rerender();
  });
  actions.append(btn);

  const saved = loadGame();
  if (saved && saved.world === world.name) {
    const resume = el('button');
    resume.textContent = `继续上局 · 命签 #${saved.seed}（已替 TA 抉择 ${saved.picked.length} 次）`;
    resume.addEventListener('click', () => {
      resumeFromSave(saved);
    });
    actions.append(resume);
  } else if (saved) {
    clearGame();
  }

  const importBtn = el('button');
  importBtn.textContent = '导入存档…';
  importBtn.addEventListener('click', () => {
    importOpen = !importOpen;
    rerender();
  });
  actions.append(importBtn);
  scene.append(actions);

  if (importOpen) scene.append(buildImportBox());
  return scene;
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

// ═══════════════════════════════════════════════
// 推进场景（出生卡 + 属性条 + 日志流 + 操作区）
// ═══════════════════════════════════════════════

function buildLifeScene(r: LifeResult): HTMLElement {
  const scene = el('section', 'scene life-scene');
  // 顶部 sticky banner：播放控制 + 速度 + 进度条
  scene.append(buildControlBanner(r));
  // 双栏主体
  const body = el('div', 'life-body');
  // 左侧面板：场景图 + 身份卡 + 状态指数
  const sidebar = el('div', 'life-sidebar');
  sidebar.append(buildSceneImage(r), buildBirthCard(), buildAttrsBar(r));
  // 右侧面板：人生记录流
  const main = el('div', 'life-main');
  main.append(buildLogStream(r));
  body.append(sidebar, main);
  scene.append(body);
  return scene;
}

/** 根据 birth 信息合成场景图片（场景底图 + 主角图层 + 特效图层） */
function buildSceneImage(r: LifeResult): HTMLElement {
  const wrap = el('div', 'scene-image');
  const b = r.birth;
  if (!b) return wrap;
  // 异步合成：Canvas 纸娃娃合成器
  const params = deriveParams(b, r.log?.[0]?.tick ?? 0);
  composeScene(params).then((canvas) => {
    if (canvas) {
      canvas.setAttribute('aria-label', identityFor(b).birthplace);
      wrap.append(canvas);
    } else {
      // 合成失败：回退到纯场景底图
      const place = normalizePlace(b.region);
      const era = normalizeEra(b.era);
      const img = el('img');
      img.alt = identityFor(b).birthplace;
      img.loading = 'lazy';
      img.src = `./assets/images/scenes/${place}_${era}.png`;
      img.onerror = () => { wrap.style.display = 'none'; };
      wrap.append(img);
    }
  }).catch(() => { wrap.style.display = 'none'; });
  return wrap;
}

function buildBirthCard(): HTMLElement {
  const card = el('div', 'birth-card');
  // 卡片头部：命签 + 入世标题 一体化设计
  const header = el('div', 'birth-header');
  const seal = el('div', 'birth-seal');
  seal.textContent = `命签 #${state.seed}`;
  const title = el('div', 'birth-title');
  title.textContent = '入世';
  header.append(seal, title);
  card.append(header);
  const b = state.result?.birth;
  if (!b) return card;
  const id = identityFor(b);
  // 角色名
  const nameEl = el('div', 'birth-name');
  nameEl.textContent = id.name;
  card.append(nameEl);
  const rows: Array<[string, string]> = [
    ['性别', id.gender],
    ['形态', formText(b.form, b.species, b.variety, b.niche)],
    ['降生之地', id.birthplace],
  ];
  if (b.lixi) rows.push(['灵系显性', lixiText(b.lixi, b.dualLixi)]);
  if (b.liqiManifest) rows.push(['灵气感应', '已显']);
  if (b.cultivator) rows.push(['修行机缘', '已开启']);
  if (b.reincarnatedSoul) rows.push(['异兆', '转世魂灵']);
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
      li.textContent = preBirthText(b, entry.eventId, entry.label, id);
      pre.append(li);
    }
    card.append(pre);
  }
  return card;
}

function buildAttrsBar(r: LifeResult): HTMLElement {
  const bar = el('div', 'attrs');
  // 根据 pointer 位置计算当前进度对应的中间状态
  const cur = currentAttrs(r);
  const pairs: Array<[string, number | string]> = [
    ['岁', cur.tick],
    ['健康', Math.round(cur.attrs['health'] ?? 0)],
    ['灵质', Math.round(cur.attrs['liquality'] ?? 0)],
    ['灵力', Math.round(cur.attrs['spirit'] ?? 0)],
  ];
  const tier = cur.flags.find((f) => f.startsWith('tier:'));
  if (tier) pairs.push(['阶位', tier.slice(5)]);
  if (r.birth?.cultivator) pairs.push(['修行', '在道']);
  for (const [k, v] of pairs) {
    const chip = el('span', 'chip');
    chip.textContent = `${k} ${v}`;
    bar.append(chip);
  }
  return bar;
}

/** 根据当前 pointer 位置，从初始属性累加 effects，得到当前进度对应的中间状态 */
function currentAttrs(r: LifeResult): { tick: number; attrs: Record<string, number>; flags: string[] } {
  const lines = narrativeLines(r);
  const shown = lines.slice(0, state.pointer);
  // 从初始属性开始累加
  const attrs: Record<string, number> = { ...world.initAttrs };
  const flags: string[] = [];
  let tick = world.startTick;
  for (const line of shown) {
    tick = line.tick;
    if (line.effects) {
      for (const [k, v] of Object.entries(line.effects)) {
        attrs[k] = (attrs[k] ?? 0) + v;
      }
    }
  }
  // flags 从最终状态中按 tick 截取（LogEntry 不记录 flag 变更，只能近似取最终状态）
  // 但 tier 等关键 flag 在 log label 中有体现，这里用最终 flags 做近似
  for (const f of r.state.flags) {
    if (f.startsWith('tier:')) {
      // 阶位 flag 在推进过程中可能已获得，这里保守取最终值
      flags.push(f);
    }
  }
  return { tick, attrs, flags };
}

function buildLogStream(r: LifeResult): HTMLElement {
  const stream = el('div', 'log-stream');
  const lines = narrativeLines(r);
  const shown = lines.slice(0, state.pointer);
  const birth = r.birth;
  const id = birth ? identityFor(birth) : null;
  // 倒序：最新展开的在最前
  for (let i = shown.length - 1; i >= 0; i--) {
    const line = shown[i]!;
    const row = el('div', 'log-line');
    // 最新展开的一行加淡入动画
    if (i === shown.length - 1 && state.pointer > 0) row.classList.add('log-fresh');
    if (worldMilestones.includes(line.eventId)) row.classList.add('milestone');
    if (line.isPrompt) row.classList.add('prompt');
    if (state.starredLines.has(i)) row.classList.add('starred');
    row.dataset.idx = String(i);
    // 星标按钮
    const star = el('span', 'star-btn');
    star.textContent = state.starredLines.has(i) ? '★' : '☆';
    star.title = '点选加星';
    // 年龄（出生前/降生/岁数，不再显示日历年）
    const age = el('span', 'age');
    age.textContent = ageLabel(line.tick);
    const text = el('span', 'log-text');
    const isPreBirth = birth !== undefined && id !== null
      && (line.eventId === 'birth' || line.eventId.startsWith('pre_birth/'));
    text.textContent = isPreBirth
      ? preBirthText(birth, line.eventId, line.rawLabel, id)
      : (line.isPrompt ? `❈ ${line.text}` : line.text);
    if (line.picked) {
      const pick = el('span', 'picked');
      pick.textContent = `（抉择：${line.picked}）`;
      text.append(pick);
    }
    const fx = formatEffects(line.effects);
    if (fx) {
      const eff = el('span', 'effects-hint');
      eff.textContent = `〔${fx}〕`;
      text.append(eff);
    }
    if (line.caption) {
      const cap = el('span', 'milestone-caption');
      cap.textContent = `〔${line.caption}〕`;
      text.append(cap);
    }
    row.append(star, age, text);
    // 点击整行切换星标
    row.addEventListener('click', () => {
      const idx = Number(row.dataset.idx);
      if (state.starredLines.has(idx)) state.starredLines.delete(idx);
      else state.starredLines.add(idx);
      rerender();
    });
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

/** 每次翻页展开的条数：1-3 条，遇到抉择点自动停止 */
function advancePointer(r: LifeResult): void {
  const lines = narrativeLines(r);
  const max = Math.min(state.pointer + 3, lines.length);
  // 逐条推进，遇到抉择 prompt 则在此停下（下一帧自动切到抉择场景）
  while (state.pointer < max) {
    state.pointer++;
    // 如果刚展开的条目是抉择 prompt，停止翻页（下一次 rerender 会进入抉择场景）
    if (lines[state.pointer - 1]?.isPrompt) break;
  }
}

/** 顶部 sticky 控制条——播放/暂停 + 速度 + 日历年 + 进度条 + 存档 */
function buildControlBanner(r: LifeResult): HTMLElement {
  const banner = el('div', 'control-banner');
  // 左侧：播放/暂停 + 速度
  const left = el('div', 'ctrl-left');
  const playBtn = el('button', state.autoPlay ? 'pause-btn' : 'primary');
  playBtn.textContent = state.autoPlay ? '⏸ 暂停' : '▶ 播放';
  playBtn.addEventListener('click', () => {
    if (state.autoPlay) {
      state.autoPlay = false;
      clearAutoTimer();
    } else {
      startAutoPlay(r);
    }
    rerender();
  });
  left.append(playBtn);
  // 速度档位
  const speedWrap = el('span', 'speed-ctrl');
  for (let i = 0; i < SPEED_LABELS.length; i++) {
    const [label] = SPEED_LABELS[i]!;
    const sb = el('button', i === state.speedIdx ? 'active' : '');
    sb.textContent = label;
    sb.addEventListener('click', () => {
      state.speedIdx = i;
      if (state.autoPlay) {
        clearAutoTimer();
        startAutoPlay(r);
      }
      rerender();
    });
    speedWrap.append(sb);
  }
  left.append(speedWrap);
  banner.append(left);
  // 中间：日历年（保留纪年，移除进度条）
  const center = el('div', 'ctrl-center');
  const yearLabel = el('span', 'year-label');
  const curTick = state.pointer > 0 ? narrativeLines(r)[state.pointer - 1]!.tick : 0;
  yearLabel.textContent = calendarYear(curTick);
  center.append(yearLabel);
  banner.append(center);
  // 右侧：存档
  banner.append(buildSaveButtons());
  return banner;
}

/** 启动自动播放——链式 setTimeout，每步延迟根据内容变化 */
function startAutoPlay(r: LifeResult): void {
  state.autoPlay = true;
  clearAutoTimer();
  autoTimer = setTimeout(() => tickAdvance(r), calcDelay(r));
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

// ═══════════════════════════════════════════════
// 抉择场景
// ═══════════════════════════════════════════════

function buildChoiceScene(r: LifeResult): HTMLElement {
  const scene = el('section', 'scene choice-scene');
  const choice = r.pausedChoice!;
  // 抉择点优先用叙事库 prompt（含槽位），缺失时回退世界原文
  const narratedPrompt = r.pausedEventId
    ? new NarrativeRenderer(world, r.birth).renderPrompt(r.pausedEventId, r.state)
    : undefined;
  const prompt = el('p', 'choice-prompt-big');
  prompt.textContent = narratedPrompt ?? choice.prompt;
  scene.append(prompt);

  const options = el('div', 'choice-options');
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
      // 跳过当前抉择 prompt 行，从下一条叙事继续播放
      const lines = narrativeLines(state.result!);
      // pointer 当前指向抉择 prompt 的下一条，但如果新 result 在此位置仍是 prompt，则跳过
      while (state.pointer < lines.length && lines[state.pointer]?.isPrompt) {
        state.pointer++;
      }
      // 抉择后自动恢复播放
      state.autoPlay = true;
      rerender();
      if (state.result) startAutoPlay(state.result);
    });
    options.append(btn);
  });
  scene.append(options);
  return scene;
}

// ═══════════════════════════════════════════════
// 终局场景
// ═══════════════════════════════════════════════

function buildEndScene(r: LifeResult): HTMLElement {
  clearGame();
  const scene = el('section', 'scene end-scene');
  // 死因氛围色
  const causeClass = r.deathCause === 'health' ? 'death-health'
    : r.deathCause === 'hazard' ? 'death-hazard'
    : r.deathCause === 'terminal:ascend_trigger' ? 'death-ascend'
    : r.deathCause === 'liquality_exhausted' ? 'death-liquality_exhausted'
    : r.state.alive ? 'death-alive_end'
    : '';
  if (causeClass) scene.classList.add(causeClass);
  const title = el('h3', 'end-title');
  title.textContent = '此生落幕';
  const info = el('p', 'end-info');
  const finalTick = r.deathTick ?? r.state.tick;
  const cultivatorNote = r.birth?.cultivator ? ' · 修行者' : '';
  info.textContent = `${deathLabel(r)} · 终年 ${finalTick}${cultivatorNote} · 人生指纹 ${hashLife(r)}`;
  scene.append(title, info);

  // 人生纹理（仅活到成年 tick≥18 才显示）
  if (r.texture) {
    const texBox = el('div', 'life-texture');
    const texLabel = el('p', 'texture-label');
    texLabel.textContent = '人生纹理';
    const texCode = el('p', 'texture-code');
    texCode.textContent = r.texture.label;
    const texDesc = el('p', 'texture-desc');
    texDesc.textContent = r.texture.desc;
    texBox.append(texLabel, texCode, texDesc);
    scene.append(texBox);
  }

  const actions = el('div', 'end-actions');
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
    clearAutoTimer();
    state.picked = [];
    state.pointer = 0;
    state.review = false;
    state.autoPlay = false;
    state.starredLines.clear();
    state.seed = drawSeed();
    state.result = runSegment(world, state.seed, state.picked);
    persist();
    resetFlowUi();
    state.drawing = true;
    rerender();
  });
  const newBtn = el('button');
  newBtn.textContent = '另抽一签';
  newBtn.addEventListener('click', () => {
    clearAutoTimer();
    state.seed = null;
    state.result = null;
    state.picked = [];
    state.pointer = 0;
    state.review = false;
    state.autoPlay = false;
    state.starredLines.clear();
    resetFlowUi();
    clearGame();
    rerender();
  });
  actions.append(reviewBtn, shareBtn, redoBtn, newBtn);
  scene.append(actions);

  if (shareOpen) scene.append(buildShareCard(r));
  return scene;
}

function buildShareText(r: LifeResult): string {
  const lines: string[] = ["【Souls' Draw · 生灵引 · 罗小黑世界】一签一命"];
  const b = r.birth;
  if (b) {
    const id = identityFor(b);
    lines.push(`命签 #${state.seed} · ${id.name} · ${formText(b.form, b.species, b.variety, b.niche)}`);
    lines.push(`降生于 ${id.birthplace}`);
  }
  const finalTick = r.deathTick ?? r.state.tick;
  lines.push(`终年 ${finalTick} · ${deathLabel(r)}`);
  if (r.texture) lines.push(`人生纹理 ${r.texture.label}（${r.texture.desc}）`);
  lines.push(`人生指纹 ${hashLife(r)} · 替 TA 抉择 ${state.picked.length} 次`);
  lines.push('——');
  const data = currentSave();
  if (data) {
    lines.push('复现此生（存档 JSON，导入即可重走同一条人生）：');
    lines.push(JSON.stringify({ v: data.v, world: data.world, seed: data.seed, picked: data.picked }));
  }
  lines.push("同 seed + 同抉择序列 = 同一生 · Souls' Draw · 客户端生成 · 零上传");
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
    a.download = `souls-draw-life-${state.seed}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
  actions.append(copy, dl, msg);
  box.append(pre, actions);
  return box;
}

// ═══════════════════════════════════════════════
// 回顾场景——岁月长河时间线
// ═══════════════════════════════════════════════

function buildReviewScene(): HTMLElement {
  const r = state.result!;
  const scene = el('section', 'scene review-scene');

  const header = el('div', 'review-header');
  const h2 = el('h2');
  h2.textContent = '一生回顾';
  const sub = el('p', 'muted');
  const finalTick = r.deathTick ?? r.state.tick;
  const b = r.birth;
  const id = b ? identityFor(b) : null;
  sub.textContent = `终年 ${finalTick} · ${deathLabel(r)}${b && id ? ` · ${id.name} · 降生于 ${id.birthplace} · ${formText(b.form, b.species, b.variety, b.niche)}` : ''} · 共历 ${r.log.length} 段岁月`;
  header.append(h2, sub);
  scene.append(header);

  const timeline = el('div', 'review-timeline');
  const decades = new Map<number, Array<{ text: string; milestone: boolean }>>();
  for (const line of narrativeLines(r)) {
    const segSize = line.tick < 100 ? 10 : 50;
    const dec = Math.floor(line.tick / segSize) * segSize;
    let text = line.isPrompt ? `❈ ${line.text}` : line.text;
    if (line.caption) text += `〔${line.caption}〕`;
    if (line.picked) text += `（抉择：${line.picked}）`;
    const list = decades.get(dec) ?? [];
    list.push({ text, milestone: worldMilestones.includes(line.eventId) });
    decades.set(dec, list);
  }
  for (const dec of [...decades.keys()].sort((a, b2) => a - b2)) {
    const seg = el('div', 'review-segment');
    const hasMilestone = decades.get(dec)!.some((e) => e.milestone);
    if (hasMilestone) seg.classList.add('milestone');
    const h4 = el('h4');
    const segSize = dec < 100 ? 10 : 50;
    const segEnd = dec + segSize - 1;
    h4.textContent = dec === 0 ? `童年（0-9 岁 · ${calendarYear(0)}起）` : `${dec}-${segEnd} 岁段 · ${calendarYear(dec)}起`;
    const ul = el('ul');
    for (const entry of decades.get(dec)!) {
      const li = el('li');
      if (entry.milestone) {
        const marker = el('span', 'milestone-marker');
        marker.textContent = '★ ';
        li.append(marker);
      }
      const span = el('span');
      span.textContent = entry.text;
      li.append(span);
      ul.append(li);
    }
    seg.append(h4, ul);
    timeline.append(seg);
  }
  scene.append(timeline);

  const back = el('button');
  back.textContent = '返回终局';
  back.addEventListener('click', () => {
    state.review = false;
    rerender();
  });
  scene.append(back);
  return scene;
}

// ═══════════════════════════════════════════════

function rerender(): void {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) return;
  // 推进场景下的自动播放——增量更新控制栏+日志流+属性条，不重建整个 DOM，避免滚动抖动
  const r = state.result;
  const lifeMain = app.querySelector<HTMLElement>('.life-main');
  if (r && !state.review && !state.drawing && lifeMain) {
    const atEnd = state.pointer >= r.log.length;
    // 只在未到末尾时走增量更新；到末尾需全量重建以切换到抉择/终局场景
    if (!atEnd) {
      // 更新控制栏
      const oldBanner = app.querySelector('.control-banner');
      if (oldBanner) oldBanner.replaceWith(buildControlBanner(r));
      // 更新日志流
      const oldStream = lifeMain.querySelector('.log-stream');
      const newStream = buildLogStream(r);
      if (oldStream) oldStream.replaceWith(newStream);
      // 更新属性条
      const sidebar = app.querySelector<HTMLElement>('.life-sidebar');
      if (sidebar) {
        const oldAttrs = sidebar.querySelector('.attrs');
        const newAttrs = buildAttrsBar(r);
        if (oldAttrs) oldAttrs.replaceWith(newAttrs);
      }
      newStream.scrollTop = 0;
      return;
    }
  }
  // 其他场景——全量重建
  app.replaceChildren();
  renderLifeScreen(app);
}

export { renderLifeScreen, FORM_LABELS, DEATH_LABELS };
