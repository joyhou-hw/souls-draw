import { hashLife } from '../../../engine/src/engine.ts';
import { NarrativeRenderer, renderLifeLog, type RenderedLogLine } from '../../../engine/src/narrative.ts';
import type { BirthOutcome, LifeResult } from '../../../engine/src/types.ts';
import { createRng } from '../../../engine/src/rng.ts';
import { runSegment } from '../game.ts';
import { world, worldMilestones } from '../world.ts';
import { saveGame, loadGame, clearGame, parseSave, downloadSave, type SaveData } from '../save.ts';
import { deriveParams, normalizePlace, normalizeEra } from '../imaging/composer.ts';
import { getManifest, loadManifest, findActor, findEffect, ASSET_BASE, type ComposeParams, type Manifest } from '../imaging/manifest.ts';

const FORM_LABELS: Record<string, string> = {
  human: '凡人',
  animal_yao: '兽妖',
  plant_yao: '草木妖',
  fungus_yao: '菌蕈妖',
  spirit_yao: '游灵',
  painted_yao: '器灵',
};

const TIER_LABELS: Record<string, string> = {
  fanti: '凡体',
  ningxing: '凝形',
  yuwu: '御物',
  lingyu: '灵域',
  dayao: '大妖',
  shengling: '生灵',
  ascend: '飞升',
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
  /** 抉择自动选择开关：开启后每次抉择倒计时自动随机选 */
  autoChoice: boolean;
}

const state: LifeUiState = {
  seed: null, picked: [], pointer: 0, result: null, review: false, drawing: false,
  autoPlay: false, speedIdx: 0, starredLines: new Set(), drawPhase: 0,
  autoChoice: false,
};

let autoChoiceTimer: ReturnType<typeof setTimeout | typeof setInterval> | null = null;

function clearAutoChoiceTimer(): void {
  if (autoChoiceTimer !== null) { clearInterval(autoChoiceTimer); clearTimeout(autoChoiceTimer); autoChoiceTimer = null; }
}

/** 抉择自动选择：倒计时结束后随机选一项 */
function startAutoChoiceCountdown(scene: HTMLElement, r: LifeResult): void {
  clearAutoChoiceTimer();
  let remaining = 3;
  const updateCountdown = (): void => {
    const display = scene.querySelector<HTMLElement>('.auto-choice-countdown');
    if (!display) return;
    if (remaining <= 0) {
      display.textContent = '代为抉择中…';
    } else {
      display.textContent = `${remaining}`;
    }
  };
  updateCountdown();
  autoChoiceTimer = setInterval((): void => {
    remaining--;
    if (remaining <= 0) {
      clearAutoChoiceTimer();
      const display = scene.querySelector<HTMLElement>('.auto-choice-countdown');
      if (display) display.textContent = '代为抉择中…';
      // 延迟 300ms 再选，给"代为抉择中…"一个短暂展示
      setTimeout((): void => {
        const choice = r.pausedChoice!;
        const idx = Math.floor(Math.random() * choice.options.length);
        executeChoice(r, idx);
      }, 300);
    } else {
      updateCountdown();
    }
  }, 1000);
}

/** 执行抉择——提取为公共函数，供手动点击和自动选择复用 */
function executeChoice(r: LifeResult, idx: number): void {
  clearAutoChoiceTimer();
  // 当前场景飞走动画
  const currentScene = document.querySelector('.choice-scene');
  if (currentScene) currentScene.classList.add('scene-flyaway');
  setTimeout(() => {
    state.picked.push(idx);
    state.result = runSegment(world, state.seed!, state.picked);
    persist();
    const lines = narrativeLines(state.result!);
    while (state.pointer < lines.length && lines[state.pointer]?.isPrompt) {
      state.pointer++;
    }
    state.autoPlay = true;
    // 保存滚动位置（log-stream 内部 + 窗口），rerender 后恢复
    const oldStream = document.querySelector('.log-stream');
    const savedStreamTop = oldStream ? oldStream.scrollTop : 0;
    const savedScrollY = window.scrollY;
    rerender();
    // 恢复 log-stream 内部滚动位置
    const newStream = document.querySelector('.log-stream');
    if (newStream) newStream.scrollTop = savedStreamTop;
    window.scrollTo(0, savedScrollY);
    if (state.result) startAutoPlay(state.result);
  }, 400);
}

/** 速度档位：标签 → 间隔毫秒（对标 80亿分之一 1x~8x） */
const SPEED_LABELS: Array<[string, number]> = [
  ['1×', 8000],
  ['2×', 4000],
  ['4×', 2000],
  ['8×', 800],
];

/** 纪元名称与起始年份范围——古代/现代分别有不同波动区间 */
const ERA_CONFIG: Record<string, { name: string; yearRange: [number, number] }> = {
  ancient: { name: '古代', yearRange: [320, 580] },
  modern: { name: '现代', yearRange: [1180, 1420] },
};
const DEFAULT_ERA = 'ancient';

/** 根据 era 生成确定性起始年份（由 seed 决定，同一 seed 同一年份） */
let birthYearMemo: { seed: number; era: string; year: number } | null = null;
function birthYearFor(era: string, seed: number): number {
  if (birthYearMemo?.seed === seed && birthYearMemo?.era === era) return birthYearMemo.year;
  const cfg = ERA_CONFIG[era] ?? ERA_CONFIG[DEFAULT_ERA]!;
  const rng = createRng((seed ^ 0x12345678) >>> 0);
  const year = cfg.yearRange[0] + Math.floor(rng.next() * (cfg.yearRange[1] - cfg.yearRange[0] + 1));
  birthYearMemo = { seed, era, year };
  return year;
}

/** 获取当前人生的纪元名称 */
function eraName(): string {
  const era = state.result?.birth?.era ?? DEFAULT_ERA;
  return (ERA_CONFIG[era] ?? ERA_CONFIG[DEFAULT_ERA]!).name;
}

/** 获取当前人生的出生年份 */
function birthYear(): number {
  const era = state.result?.birth?.era ?? DEFAULT_ERA;
  return birthYearFor(era, state.seed ?? 0);
}

/** 根据 tick 计算日历年 */
function calendarYear(tick: number): string {
  return `${eraName()}${birthYear() + tick}年`;
}

/** 日志行年龄标注——出生前/降生/岁数 */
function ageLabel(tick: number): string {
  if (tick < 0) return '入世前';
  if (tick === 0) return '降生';
  return `${tick}岁`;
}

let autoTimer: ReturnType<typeof setTimeout> | null = null;
let endTransitionPlayed = false;
let visibilityBound = false;

function clearAutoTimer(): void {
  if (autoTimer !== null) { clearTimeout(autoTimer); autoTimer = null; }
}

/** 页面可见性变化——切走自动暂停，回来不自动恢复（用户手动点继续） */
function bindVisibilityPause(): void {
  if (visibilityBound) return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.autoPlay) {
      state.autoPlay = false;
      clearAutoTimer();
      // 更新播放按钮为"继续此生"
      const btn = document.querySelector<HTMLButtonElement>('.control-banner .pause-btn, .control-banner .primary');
      if (btn) { btn.textContent = '▶ 继续此生'; btn.className = 'primary'; }
    }
  });
}

/** 终局过场动画：模拟页面渐隐 → 图像居中变灰 → 年岁/成就依次浮现 → 切到终局 */
function playEndTransition(r: LifeResult): void {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) { rerender(); return; }

  // 全屏覆盖层
  const overlay = el('div', 'end-transition-overlay');
  // 克隆当前场景图作为居中图像
  const sceneImg = app.querySelector<HTMLImageElement>('.layer-scene');
  const actorImg = app.querySelector<HTMLImageElement>('.layer-actor');
  const imgBox = el('div', 'end-transition-img');
  if (sceneImg) {
    const bg = el('img');
    bg.src = sceneImg.src;
    bg.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;';
    imgBox.append(bg);
  }
  if (actorImg) {
    const ac = el('img');
    ac.src = actorImg.src;
    ac.style.cssText = 'width:100%;height:100%;object-fit:contain;object-position:center bottom;position:absolute;inset:0;';
    imgBox.append(ac);
  }
  overlay.append(imgBox);

  // 信息文本容器
  const infoBox = el('div', 'end-transition-info');
  overlay.append(infoBox);

  document.body.append(overlay);
  void overlay.offsetWidth; // 强制 reflow
  overlay.classList.add('end-transition-active');

  const finalTick = r.deathTick ?? r.state.tick;
  const id = r.birth ? identityFor(r.birth) : null;
  const name = id?.name ?? '此生';

  // 依次浮现的信息
  const steps: Array<{ text: string; delay: number }> = [
    { text: `${name} · ${calendarYear(0)}`, delay: 800 },
    { text: `生于 ${id?.birthplace ?? '此世'}，终于 ${finalTick} 岁`, delay: 1600 },
    { text: deathLabel(r), delay: 1400 },
    { text: '此生落幕', delay: 1200 },
  ];

  let totalDelay = 600; // 初始等待页面渐隐
  for (const step of steps) {
    setTimeout((t) => {
      const line = el('p', 'end-transition-line');
      line.textContent = t;
      infoBox.append(line);
      void line.offsetWidth;
      line.classList.add('end-transition-line-show');
    }, totalDelay, step.text);
    totalDelay += step.delay;
  }

  // 最后一步：淡出切到终局
  setTimeout(() => {
    overlay.classList.add('end-transition-fadeout');
    setTimeout(() => {
      overlay.remove();
      endTransitionPlayed = true;
      rerender();
    }, 800);
  }, totalDelay + 400);
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
    playEndTransition(r);
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
  const isHuman = birth.form === 'human';
  const gender = rng.pick(isHuman ? ['男', '女'] : ['雄', '雌']);
  const surname = rng.pick(SURNAMES);
  const given = (isHuman ? gender === '男' : gender === '雄')
    ? rng.pick(GIVEN_MALE) : rng.pick(GIVEN_FEMALE);
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

// ═══════════════════════════════════════════════
// 引导页词库——按 era × region 组合生成时代背景叙述
// ═══════════════════════════════════════════════

interface IntroLines {
  eraYear: string;      // 哪一年
  eraEvent: string;    // 社会上刚发生了什么
  placeDesc: string;   // 这是什么地方
  placeFeature: string; // 有什么特色
}

const INTRO_POOL: Record<string, IntroLines[]> = {
  // ── 古代 ──
  'ancient:forest': [
    { eraYear: '太古年间', eraEvent: '天地灵气初凝，妖兽蛰伏深林', placeDesc: '一片人迹罕至的原始幽林', placeFeature: '古木参天，灵药遍地，兽语可闻' },
    { eraYear: '洪荒末年', eraEvent: '大妖陨落，山林震动', placeDesc: '妖兽盘踞的密林深处', placeFeature: '瘴气弥漫，险兽出没，偶见仙草' },
    { eraYear: '灵寂初年', eraEvent: '灵脉沉寂百年后初现复苏', placeDesc: '被遗忘的远古森林', placeFeature: '枯木逢春，灵泉涌动，生机暗涌' },
  ],
  'ancient:city': [
    { eraYear: '太古年间', eraEvent: '人族筑城自守，妖族虎视城外', placeDesc: '一座依山而建的古城', placeFeature: '青石铺街，符阵护城，坊市林立' },
    { eraYear: '洪荒末年', eraEvent: '城主更替，新令初颁', placeDesc: '烟火气缭绕的繁华旧城', placeFeature: '夜市灯火，酒旗招展，各色人等混杂' },
    { eraYear: '灵寂初年', eraEvent: '百年封城令解除，商队复通', placeDesc: '一座沉寂百年的古城', placeFeature: '城门重开，百业待兴，暗流涌动' },
  ],
  'ancient:guild_land': [
    { eraYear: '太古年间', eraEvent: '修行会馆初立门规，广纳门徒', placeDesc: '修行者聚居的会馆领地', placeFeature: '藏经阁高耸，练法坪开阔，规矩森严' },
    { eraYear: '洪荒末年', eraEvent: '会馆长老闭关，弟子各怀心思', placeDesc: '内忧外患的修行会馆', placeFeature: '禁地封锁，阵法闪烁，人心浮动' },
    { eraYear: '灵寂初年', eraEvent: '会馆重开山门，广收新徒', placeDesc: '百废待兴的修行会馆', placeFeature: '残垣断壁间灵光重现，师承断续' },
  ],
  'ancient:hermit_island': [
    { eraYear: '太古年间', eraEvent: '隐士封岛，不问世事', placeDesc: '碧海孤悬的隐修之岛', placeFeature: '潮声如诵经，崖上有仙鹤，洞府隐现' },
    { eraYear: '洪荒末年', eraEvent: '岛上老祖渡劫，天象异变', placeDesc: '劫云笼罩的孤岛', placeFeature: '雷光冲天，海兽退避，灵气暴涌' },
    { eraYear: '灵寂初年', eraEvent: '封岛禁制松动，隐士渐出', placeDesc: '解封后的隐修之岛', placeFeature: '云雾散去，石径重见，修士下山' },
  ],
  // ── 现代 ──
  'modern:forest': [
    { eraYear: '新元年间', eraEvent: '灵气复苏，城市边缘的森林异变', placeDesc: '被钢筋水泥包围的残存绿地', placeFeature: '古树与霓虹共存，灵兽与流浪猫争地盘' },
    { eraYear: '新元末年', eraEvent: '灵脉贯通地底，森林公园异象频发', placeDesc: '城市中的灵气异常区', placeFeature: '游客夜见荧光，保安不敢巡逻，妖怪摆摊' },
    { eraYear: '新元初年', eraEvent: '灵气监测站刚建成，数据异常', placeDesc: '被围栏圈起的保护林区', placeFeature: '仪器闪烁红光，松鼠体型异常，空气发甜' },
  ],
  'modern:city': [
    { eraYear: '新元年间', eraEvent: '妖族身份合法化法案刚通过', placeDesc: '一座灵气与科技交融的都市', placeFeature: '高楼林立，符文路灯，地铁可直达妖市' },
    { eraYear: '新元末年', eraEvent: '灵气科技公司股价暴涨，社会热议', placeDesc: '霓虹闪烁的繁华都市', placeFeature: '外卖骑手踩着飞剑，写字楼里人妖共事' },
    { eraYear: '新元初年', eraEvent: '第一次人妖联合大学刚开学', placeDesc: '正在适应新时代的古城', placeFeature: '老城区巷弄有灵宠医院，新城区有灵气充电桩' },
  ],
  'modern:guild_land': [
    { eraYear: '新元年间', eraEvent: '修行会馆转型注册，纳入管理体系', placeDesc: '挂着企业牌照的修行会馆', placeFeature: '练法坪改成了健身房，藏经阁装了WiFi' },
    { eraYear: '新元末年', eraEvent: '会馆内部改革，老派弟子与新时代冲突', placeDesc: '新旧交替的修行会馆', placeFeature: '电子门禁旁刻着古老符阵，食堂兼供辟谷餐' },
    { eraYear: '新元初年', eraEvent: '修行资格证考试刚落地，报考火爆', placeDesc: '转型中的现代修行会馆', placeFeature: '大屏幕滚动播放考试公告，灵气检测仪嗡嗡作响' },
  ],
  'modern:hermit_island': [
    { eraYear: '新元年间', eraEvent: '隐士岛被划为灵气保护区', placeDesc: '立了石碑的隐修之岛', placeFeature: '禁飞令牌立在码头，渡轮每天一班，仙鹤戴了脚环' },
    { eraYear: '新元末年', eraEvent: '岛上灵气潮汐异常，研究团队登岛', placeDesc: '科研与隐修共存的孤岛', placeFeature: '气象站与洞府比邻，数据线缠在古松上' },
    { eraYear: '新元初年', eraEvent: '隐士岛首次开放旅游，限额登岛', placeDesc: '刚通 ferry 的隐修之岛', placeFeature: '石阶上嵌了引导灯，崖边装了护栏，隐士摆摊卖手串' },
  ],
};

/** 根据出生结果选取引导页内容 */
function pickIntroLines(birth: BirthOutcome, seed: number): IntroLines {
  const era = normalizeEra(birth.era);
  const region = normalizePlace(birth.region);
  const key = `${era}:${region}`;
  const pool = INTRO_POOL[key] ?? INTRO_POOL['ancient:forest']!;
  const rng = createRng((seed ^ 0xabcd1234) >>> 0);
  return rng.pick(pool);
}

/** 显示引导页——与模拟页同一背景，逐行文字出现后消失，点击进入模拟 */
function showIntroPage(birth: BirthOutcome, seed: number, bgSrc: string, onEnter: () => void): void {
  const lines = pickIntroLines(birth, seed);
  const eraLabel = slotText('era', birth.era);
  const yearStr = calendarYear(0);
  const id = identityFor(birth);
  const place = slotText('place', birth.region);
  const locality = LOCALITY_BY_REGION[birth.region]?.[0] ?? '无名之地';

  const overlay = el('div', 'intro-overlay');
  // 背景——与模拟页同
  overlay.style.backgroundImage = `url('${bgSrc}')`;

  const dim = el('div', 'intro-dim');
  overlay.append(dim);

  const container = el('div', 'intro-container');
  overlay.append(container);

  document.body.append(overlay);
  void overlay.offsetWidth;
  overlay.classList.add('intro-active');

  const texts: string[] = [
    yearStr,
    `${eraLabel} · ${lines.eraYear}`,
    lines.eraEvent,
    `降生之地 · ${place} · ${locality}`,
    lines.placeDesc,
    lines.placeFeature,
    `${id.name} · ${id.gender} · ${FORM_LABELS[birth.form] ?? birth.form}`,
  ];

  let idx = 0;
  function showNext(): void {
    if (idx >= texts.length) {
      // 全部展示完 → 显示"入世"按钮
      const enterBtn = el('button', 'primary intro-enter');
      enterBtn.textContent = '入世';
      enterBtn.addEventListener('click', () => {
        overlay.classList.remove('intro-active');
        overlay.classList.add('intro-fadeout');
        setTimeout(() => {
          overlay.remove();
          onEnter();
        }, 600);
      });
      container.append(enterBtn);
      void enterBtn.offsetWidth;
      enterBtn.classList.add('intro-enter-show');
      return;
    }
    const line = el('p', 'intro-line');
    line.textContent = texts[idx]!;
    container.append(line);
    void line.offsetWidth;
    line.classList.add('intro-line-show');

    const delay = texts[idx]!.length > 12 ? 2800 : 2200;
    idx++;
    setTimeout(() => {
      line.classList.add('intro-line-hide');
      setTimeout(() => {
        line.remove();
        showNext();
      }, 500);
    }, delay);
  }

  setTimeout(showNext, 400);
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

// ═══════════════════════════════════════════════
// 页面/模拟背景图——按场景类型与（种族×性别×阶段）确定性切换
// ═══════════════════════════════════════════════

const PAGE_BG = {
  draw: './images/backgrounds/pages/home.webp',
  drawAnim: './images/backgrounds/pages/draw_anim.webp',
  choice: './images/backgrounds/pages/choice.webp',
  end: './images/backgrounds/pages/end.webp',
  review: './images/backgrounds/pages/review.webp',
};

function ageBandForTick(tick: number): 'child' | 'youth' | 'adult' | 'elder' {
  if (tick <= 12) return 'child';
  if (tick <= 25) return 'youth';
  if (tick <= 60) return 'adult';
  return 'elder';
}

function simBgSrc(form: string, gender: string, tick: number): string {
  const g = gender === '女' ? 'female' : 'male';
  const stage = ageBandForTick(tick);
  return `./images/backgrounds/sim/${form}/${g}_${stage}.webp`;
}

function simBgFor(r: LifeResult): string {
  const b = r.birth;
  if (!b) return '';
  const id = identityFor(b);
  return simBgSrc(b.form, id.gender, currentAttrs(r).tick);
}

function setBackground(src: string): void {
  let el = document.querySelector<HTMLElement>('#app-bg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-bg';
    document.body.appendChild(el);
  }
  el.style.backgroundImage = src ? `url('${src}')` : '';
}

function renderLifeScreen(host: HTMLElement): void {
  bindVisibilityPause();
  host.append(buildScene());
}

/** 根据当前状态确定场景类型并构建 */
function buildScene(): HTMLElement {
  // 命签抽选动画
  if (state.drawing) {
    setBackground(PAGE_BG.drawAnim);
    return buildDrawAnim();
  }

  // 未抽签 → 抽签场景
  if (state.seed === null || state.result === null) {
    setBackground(PAGE_BG.draw);
    return buildDrawScene();
  }

  // 回顾态 → 回顾场景
  if (state.review) {
    setBackground(PAGE_BG.review);
    return buildReviewScene();
  }

  const r = state.result;
  const atEnd = state.pointer >= r.log.length;

  // 抉择暂停 → 抉择场景
  if (atEnd && r.pausedChoice) {
    if (state.autoPlay) { state.autoPlay = false; clearAutoTimer(); }
    setBackground(PAGE_BG.choice);
    return buildChoiceScene(r);
  }

  // 终局 → 终局场景
  if (atEnd) {
    if (state.autoPlay) { state.autoPlay = false; clearAutoTimer(); }
    clearAutoChoiceTimer();
    setBackground(PAGE_BG.end);
    return buildEndScene(r);
  }

  // 推进中 → 推进场景（含出生卡 + 日志）
  setBackground(simBgFor(r));
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
    { label: '性别', pool: b.form === 'human' ? ['男', '女', '男', '女'] : ['雄', '雌', '雄', '雌'], final: id.gender },
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

  /** 显示生灵卡片 + "引"按钮——逐项飞入 */
  function showSoulCard(): void {
    const birth = state.result?.birth;
    if (!birth) return;
    state.drawPhase = 2;

    // roll-area 飞出
    const oldRoll = anim.querySelector('.roll-area');
    if (oldRoll) oldRoll.classList.add('roll-area-flyout');

    setTimeout(() => {
      const card = el('div', 'soul-card');
      // 场景图
      const imgWrap = buildSceneImage(state.result!);
      card.append(imgWrap);
      // 命签
      const seal = el('div', 'soul-seal');
      seal.textContent = `命签 #${state.seed}`;
      card.append(seal);

      // 信息表——先行出现
      const infoRows: Array<[string, string]> = [
        ['性别', id.gender],
        ['形态', FORM_LABELS[birth.form] ?? birth.form],
        ['降生之地', id.birthplace],
      ];
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

      // 替换 roll-area
      if (oldRoll) oldRoll.replaceWith(card);
      else anim.append(card);

      // 名字延后飞入 + 发光
      setTimeout(() => {
        const nameEl = el('h2', 'soul-name soul-name-glow');
        nameEl.textContent = id.name;
        // 插入到 seal 之后、table 之前
        table.before(nameEl);
        void nameEl.offsetWidth;
        nameEl.classList.add('soul-name-glow-on');
      }, 600);

      // "引"按钮最后出现
      setTimeout(() => {
        const enterBtn = el('button', 'primary soul-enter');
        enterBtn.textContent = '引 · 开启此生';
        enterBtn.addEventListener('click', () => {
          // 过场效果：全屏墨色淡入 → 显示引导页 → 进入人生
          const overlay = el('div', 'enter-transition');
          document.body.append(overlay);
          void overlay.offsetWidth;
          overlay.classList.add('enter-transition-fadein');
          setTimeout(() => {
            state.drawing = false;
            state.drawPhase = 0;
            const bgSrc = state.result ? simBgFor(state.result) : '';
            // 显示引导页，结束后淡出进入模拟
            showIntroPage(birth, state.seed ?? 0, bgSrc, () => {
              state.autoPlay = true;
              rerender();
              if (state.result) startAutoPlay(state.result);
            });
            overlay.classList.remove('enter-transition-fadein');
            overlay.classList.add('enter-transition-fadeout');
            setTimeout(() => overlay.remove(), 600);
          }, 800);
        });
        card.append(enterBtn);
      }, 1200);
    }, 500);
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
  desc.innerHTML = '<span class="desc-accent">签落无声</span>，人妖精怪各有归途<br><span class="desc-accent">引命成线</span>，罗小黑世界一卷浮生';
  scene.append(desc);

  const actions = el('div', 'draw-actions');
  const btn = el('button', 'primary');
  btn.textContent = '抽一签 · 开始此生';
  btn.addEventListener('click', () => {
    // 元素向后飞走动画
    const drawScene = document.querySelector('.draw-scene');
    if (drawScene) {
      drawScene.classList.add('draw-scene-flyaway');
      // 处理已保存存档按钮（如果有）
      const savedRow = drawScene.querySelector('.draw-saved');
      if (savedRow) savedRow.classList.add('draw-scene-flyaway');
    }
    setTimeout(() => {
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
    }, 600);
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
  // 主体——桌面端双栏(左:图+信息 / 右:标题+日志)，手机端单列(标题→日志→图→信息)
  const body = el('div', 'life-body');

  // 左侧栏：场景图（含状态栏叠加） + 身份卡
  const sidebar = el('div', 'life-sidebar');
  const imgWrap = buildSceneImage(r);
  imgWrap.append(buildAttrsBar(r));
  sidebar.append(imgWrap, buildBirthCard());

  // 右侧栏：岁月长卷标题 + 日志流
  const main = el('div', 'life-main');
  const logTitle = el('div', 'log-title');
  logTitle.textContent = '岁月长卷';
  // 手机端：标题后跟一行属性摘要（岁 健康 灵质 灵力）
  const attrsInline = buildAttrsBar(r);
  attrsInline.classList.add('attrs-inline');
  logTitle.append(attrsInline);
  main.append(logTitle, buildLogStream(r));

  body.append(sidebar, main);
  scene.append(body);
  return scene;
}

/** 根据 birth 信息构建场景图片——CSS 分层叠加（场景底图 + 主角图层 + 特效图层） */
// 图片元素缓存：src → HTMLImageElement，避免重建 DOM 时图片重新加载闪烁
const imgElementCache = new Map<string, HTMLImageElement>();

function buildSceneImage(r: LifeResult, tickOverride?: number, milestone?: string): HTMLElement {
  const wrap = el('div', 'scene-image layered');
  const b = r.birth;
  if (!b) return wrap;
  const tick = tickOverride ?? r.log?.[0]?.tick ?? 0;
  const params = deriveParams(b, tick, milestone);
  // 立即放置场景底图（同步，无需等待 manifest）——使用缓存的 img 元素避免闪烁
  const place = normalizePlace(b.region);
  const era = normalizeEra(b.era);
  const sceneSrc = `${ASSET_BASE}scenes/${place}_${era}.webp`;
  const sceneImg = (imgElementCache.get(sceneSrc) ?? el('img', 'layer-scene')).cloneNode(true) as HTMLImageElement;
  if (!imgElementCache.has(sceneSrc)) {
    sceneImg.className = 'layer-scene';
    sceneImg.alt = identityFor(b).birthplace;
    sceneImg.src = sceneSrc;
    sceneImg.onerror = () => { sceneImg.style.display = 'none'; };
    imgElementCache.set(sceneSrc, sceneImg);
  }
  wrap.append(sceneImg);
  // 异步加载 manifest，叠加主角图层和特效图层
  const manifest = getManifest();
  if (manifest) {
    appendActorLayer(wrap, manifest, params);
    appendEffectLayer(wrap, manifest, params);
  } else {
    loadManifest().then((m) => {
      appendActorLayer(wrap, m, params);
      appendEffectLayer(wrap, m, params);
    }).catch(() => { /* 场景底图已兜底 */ });
  }
  return wrap;
}

/** 叠加主角图层 */
function appendActorLayer(wrap: HTMLElement, manifest: Manifest, params: ComposeParams): void {
  const actor = findActor(manifest, params);
  if (!actor) return;
  const img = el('img', 'layer-actor');
  img.alt = '主角';
  img.loading = 'lazy';
  img.src = `${ASSET_BASE}${actor.file}`;
  img.onerror = () => { img.remove(); };
  wrap.append(img);
}

/** 叠加特效图层 */
function appendEffectLayer(wrap: HTMLElement, manifest: Manifest, params: ComposeParams): void {
  if (!params.milestone) return;
  const effect = findEffect(manifest, params.milestone);
  if (!effect) return;
  const img = el('img', 'layer-effect');
  img.alt = '特效';
  img.loading = 'lazy';
  img.src = `${ASSET_BASE}${effect.file}`;
  img.onerror = () => { img.remove(); };
  wrap.append(img);
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
  if (tier) {
    const tierKey = tier.slice(5);
    pairs.push(['阶位', TIER_LABELS[tierKey] ?? tierKey]);
  }
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
    if (line.isInterlude) {
      row.classList.add('interlude');
      const tag = el('span', 'interlude-tag');
      tag.textContent = '传闻';
      const text = el('span', 'log-text');
      text.textContent = line.text;
      row.append(tag, text);
      stream.append(row);
      continue;
    }
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
    // 图片预览按钮——仅里程碑事件显示（普通事件无独立景图，避免重复展示同一张）
    if (line.tick >= 0 && birth && worldMilestones.includes(line.eventId)) {
      const imgBtn = el('span', 'image-preview-btn');
      imgBtn.textContent = '🖼';
      imgBtn.title = '查看此景';
      imgBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        showImagePreview(r, line.tick, line.eventId);
      });
      row.append(imgBtn);
    }
    // 点击整行切换星标
    row.addEventListener('click', () => {
      const idx = Number(row.dataset.idx);
      if (state.starredLines.has(idx)) state.starredLines.delete(idx);
      else state.starredLines.add(idx);
      rerender();
    });
    stream.append(row);
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
  playBtn.textContent = state.autoPlay ? '⏸ 停下脚步' : '▶ 继续此生';
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
  // 中间：日历年——滚动动画，新年份从下方滑入
  const center = el('div', 'ctrl-center');
  const yearRoll = el('div', 'year-roll');
  const yearLabel = el('span', 'year-label');
  const curTick = state.pointer > 0 ? narrativeLines(r)[state.pointer - 1]!.tick : 0;
  const yearStr = calendarYear(curTick);
  yearLabel.textContent = yearStr;
  yearRoll.dataset.year = yearStr;
  yearRoll.append(yearLabel);
  center.append(yearRoll);
  banner.append(center);
  return banner;
}

/** 启动自动播放——若 pointer 尚在 0（刚入世），先立即显示第一行再开始链式调度 */
function startAutoPlay(r: LifeResult): void {
  state.autoPlay = true;
  clearAutoTimer();
  if (state.pointer === 0) {
    // 第一行立即显示，不等待延迟
    state.pointer++;
    rerender();
    if (state.autoPlay) {
      autoTimer = setTimeout(() => tickAdvance(r), calcDelay(r));
    }
  } else {
    autoTimer = setTimeout(() => tickAdvance(r), calcDelay(r));
  }
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
      // 选中的选项注入效果，其它选项破裂消散
      const allOpts = options.querySelectorAll('.choice-opt');
      allOpts.forEach((o, i) => {
        if (i === idx) {
          o.classList.add('choice-opt-injected');
        } else {
          o.classList.add('choice-opt-shatter');
        }
      });
      // 延迟执行抉择，等动画完成
      setTimeout(() => executeChoice(r, idx), 500);
    });
    options.append(btn);
  });
  scene.append(options);

  // 自动选择开关
  const autoBar = el('div', 'auto-choice-bar');
  const toggle = el('label', 'auto-choice-toggle');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = state.autoChoice;
  checkbox.addEventListener('change', () => {
    state.autoChoice = checkbox.checked;
    if (state.autoChoice) {
      startAutoChoiceCountdown(scene, r);
    } else {
      clearAutoChoiceTimer();
      const display = scene.querySelector<HTMLElement>('.auto-choice-countdown');
      if (display) display.textContent = '';
      rerender();
    }
  });
  const toggleLabel = el('span');
  toggleLabel.textContent = '代为抉择';
  toggle.append(checkbox, toggleLabel);
  autoBar.append(toggle);
  // 倒计时显示
  const countdown = el('span', 'auto-choice-countdown');
  if (state.autoChoice) countdown.textContent = '3';
  autoBar.append(countdown);
  scene.append(autoBar);

  // 如果开关已开，启动倒计时
  if (state.autoChoice) {
    startAutoChoiceCountdown(scene, r);
  }

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
    // SVG 图腾印章
    const seal = el('div', 'texture-seal');
    seal.innerHTML = buildTextureSealSVG(r.texture.code);
    // 诗句
    const texVerse = el('p', 'texture-verse');
    texVerse.textContent = `「${r.texture.verse}」`;
    const texDesc = el('p', 'texture-desc');
    texDesc.textContent = r.texture.desc;
    texBox.append(texLabel, texCode, seal, texVerse, texDesc);
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

/**
 * 根据 4 位纹理 code 生成 SVG 图腾印章。
 *
 * 正方形画布分 4 个象限，每象限对应一条 grainAxis：
 *   左上=扎根/漂泊  右上=合群/隐逸
 *   左下=守序/激进  右下=共处/独行
 * 每条轴 0=左极（阴：圆/柔/静），1=右极（阳：角/刚/动）
 * 整体呈朱红印章风格。
 */
function buildTextureSealSVG(code: string): string {
  const bits = code.split('').map((c) => c === '1');
  // 4 个象限的中心坐标（100x100 画布）
  const quads = [
    { cx: 30, cy: 30 },   // 左上：扎根/漂泊
    { cx: 70, cy: 30 },   // 右上：合群/隐逸
    { cx: 30, cy: 70 },   // 左下：守序/激进
    { cx: 70, cy: 70 },   // 右下：共处/独行
  ];
  const shapes: string[] = [];
  for (let i = 0; i < 4; i++) {
    const { cx, cy } = quads[i]!;
    const isRight = bits[i];
    if (isRight) {
      // 右极：菱形（刚/动）
      shapes.push(`<polygon points="${cx},${cy - 12} ${cx + 12},${cy} ${cx},${cy + 12} ${cx - 12},${cy}" fill="currentColor"/>`);
    } else {
      // 左极：圆形（柔/静）
      shapes.push(`<circle cx="${cx}" cy="${cy}" r="12" fill="currentColor"/>`);
    }
  }
  // 中心连接十字
  const cross = '<line x1="50" y1="18" x2="50" y2="82" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>'
    + '<line x1="18" y1="50" x2="82" y2="50" stroke="currentColor" stroke-width="1.5" opacity="0.5"/>';
  // 外框
  const border = '<rect x="6" y="6" width="88" height="88" fill="none" stroke="currentColor" stroke-width="2.5" rx="4"/>';
  return `<svg viewBox="0 0 100 100" width="72" height="72" xmlns="http://www.w3.org/2000/svg">${border}${cross}${shapes.join('')}</svg>`;
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
  if (r.texture) {
    lines.push(`人生纹理 ${r.texture.label}`);
    lines.push(`「${r.texture.verse}」`);
    lines.push(r.texture.desc);
  }
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
    let text: string;
    let milestone = false;
    if (line.isInterlude) {
      text = `〔传闻〕${line.text}`;
    } else {
      text = line.isPrompt ? `❈ ${line.text}` : line.text;
      if (line.caption) text += `〔${line.caption}〕`;
      if (line.picked) text += `（抉择：${line.picked}）`;
      milestone = worldMilestones.includes(line.eventId);
    }
    const list = decades.get(dec) ?? [];
    list.push({ text, milestone });
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

  // 照片长廊
  const galleryTitle = el('h3');
  galleryTitle.textContent = '此生光影';
  scene.append(galleryTitle);
  scene.append(buildPhotoGallery(r));

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
// 图片预览弹窗
// ═══════════════════════════════════════════════

/** 弹出图片预览模态窗——CSS 分层叠加展示 */
function showImagePreview(r: LifeResult, tick: number, eventId: string): void {
  const b = r.birth;
  if (!b) return;
  // 模态遮罩
  const overlay = el('div', 'image-modal-overlay');
  overlay.addEventListener('click', () => overlay.remove());
  // 模态框
  const modal = el('div', 'image-modal');
  modal.addEventListener('click', (e) => e.stopPropagation());
  // 关闭按钮
  const closeBtn = el('button', 'image-modal-close');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => overlay.remove());
  modal.append(closeBtn);
  // 标题
  const title = el('p', 'image-modal-title');
  title.textContent = `${ageLabel(tick)} · ${calendarYear(tick)}`;
  modal.append(title);
  // CSS 分层场景图（场景底图立即可见）
  const milestone = worldMilestones.includes(eventId) ? eventId : undefined;
  const sceneWrap = buildSceneImage(r, tick, milestone);
  sceneWrap.classList.add('image-modal-scene');
  modal.append(sceneWrap);
  overlay.append(modal);
  document.body.append(overlay);
}

// ═══════════════════════════════════════════════
// 回顾场景——照片长廊
// ═══════════════════════════════════════════════

/** 收集回顾场景的照片长廊节点——按 tick 采样关键节点合成场景图 */
function buildPhotoGallery(r: LifeResult): HTMLElement {
  const gallery = el('div', 'photo-gallery');
  const b = r.birth;
  if (!b) return gallery;
  const lines = narrativeLines(r);
  // 采样策略：里程碑事件 + 每 20 岁一个采样点（去重）
  const sampled = new Map<number, { tick: number; eventId: string; label: string }>();
  for (const line of lines) {
    if (line.tick < 0) continue;
    if (worldMilestones.includes(line.eventId)) {
      sampled.set(line.tick, { tick: line.tick, eventId: line.eventId, label: line.text });
    }
  }
  // 每 20 岁采样
  for (const line of lines) {
    if (line.tick < 0 || line.isInterlude) continue;
    const sampleTick = Math.floor(line.tick / 20) * 20;
    if (!sampled.has(sampleTick) && line.tick === sampleTick) {
      sampled.set(sampleTick, { tick: line.tick, eventId: line.eventId, label: line.text });
    }
  }
  // 降生时刻
  if (!sampled.has(0)) {
    sampled.set(0, { tick: 0, eventId: 'birth', label: '降生' });
  }
  const sorted = [...sampled.values()].sort((a, b2) => a.tick - b2.tick);
  for (const entry of sorted) {
    const thumb = el('div', 'photo-thumb');
    thumb.title = `${ageLabel(entry.tick)} · ${entry.label}`;
    const label = el('span', 'photo-thumb-label');
    label.textContent = ageLabel(entry.tick);
    thumb.append(label);
    gallery.append(thumb);
    // CSS 分层叠加缩略图（场景底图立即可见）
    const milestone = worldMilestones.includes(entry.eventId) ? entry.eventId : undefined;
    const sceneWrap = buildSceneImage(r, entry.tick, milestone);
    sceneWrap.classList.add('photo-thumb-scene');
    thumb.prepend(sceneWrap);
    // 点击放大预览
    thumb.addEventListener('click', () => showImagePreview(r, entry.tick, entry.eventId));
  }
  return gallery;
}

// ═══════════════════════════════════════════════

function rerender(): void {
  const app = document.querySelector<HTMLElement>('#app');
  if (!app) return;
  // 推进场景下的自动播放——增量更新控制栏+日志流+属性条，不重建整个 DOM，避免滚动抖动
  const r = state.result;
  const lifeBody = app.querySelector<HTMLElement>('.life-body');
  if (r && !state.review && !state.drawing && lifeBody) {
    const atEnd = state.pointer >= r.log.length;
    // 只在未到末尾时走增量更新；到末尾需全量重建以切换到抉择/终局场景
    if (!atEnd) {
      // 更新控制栏
      const oldBanner = app.querySelector('.control-banner');
      if (oldBanner) oldBanner.replaceWith(buildControlBanner(r));
      // 更新日志流
      const oldStream = lifeBody.querySelector('.log-stream');
      const newStream = buildLogStream(r);
      newStream.classList.add('life-log-stream');
      if (oldStream) oldStream.replaceWith(newStream);
      // 更新属性条（叠加在场景图内）
      const sceneImg = lifeBody.querySelector<HTMLElement>('.scene-image');
      if (sceneImg) {
        const oldAttrs = sceneImg.querySelector('.attrs');
        const newAttrs = buildAttrsBar(r);
        if (oldAttrs) oldAttrs.replaceWith(newAttrs);
      }
      // 更新手机端标题内联属性条
      const logTitle = lifeBody.querySelector('.log-title');
      if (logTitle) {
        const oldInline = logTitle.querySelector('.attrs-inline');
        const newInline = buildAttrsBar(r);
        newInline.classList.add('attrs-inline');
        if (oldInline) oldInline.replaceWith(newInline);
      }
      // 随着人生阶段推进，切换对应的模拟背景色调
      setBackground(simBgFor(r));
      // 不强制滚到顶部，保持用户阅读位置
      return;
    }
  }
  // 其他场景——全量重建
  // 如果模拟刚到末尾且不是抉择暂停，播放过场动画
  if (r && !state.review && !state.drawing && state.pointer >= r.log.length && !r.pausedChoice && !endTransitionPlayed) {
    endTransitionPlayed = true;
    playEndTransition(r);
    return;
  }
  endTransitionPlayed = false;
  app.replaceChildren();
  renderLifeScreen(app);
}

export { renderLifeScreen, FORM_LABELS, DEATH_LABELS };
