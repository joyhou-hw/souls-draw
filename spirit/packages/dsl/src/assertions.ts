import type { World } from '../../engine/src/types.ts';

export class WorldAssertionError extends Error {
  readonly rule: string;
  constructor(message: string, rule: string) {
    super(`[断言:${rule}] ${message}`);
    this.rule = rule;
    this.name = 'WorldAssertionError';
  }
}

export function assertWorldPack(world: World): void {
  if (world.powerLadder) {
    const eventIds = new Set(world.events.map((e) => e.id));
    for (const [tier, gate] of Object.entries(world.powerLadder.tierGates)) {
      if (!eventIds.has(gate.event)) {
        throw new WorldAssertionError(
          `tierGates.${tier}.event 引用的事件 "${gate.event}" 不存在`,
          'tier_gate_ref',
        );
      }
    }
  }
  const hasTerminal = world.events.some((e) => e.terminal);
  if (world.powerLadder && world.powerLadder.tiers.length >= 5 && !hasTerminal) {
    throw new WorldAssertionError('声明了阶梯却没有 terminal 事件（终点体系缺出口）', 'terminal_exists');
  }
}

export function assertLuoXiaoHeiPack(world: World): void {
  if (!world.talent) {
    throw new WorldAssertionError('罗小黑世界包必须声明 talent 块', 'talent_exists');
  }
  if (world.talent.spaceLixi.acquired !== false) {
    throw new WorldAssertionError(
      '空间系灵质不可后天习得（acquired 必须为 false，火影血继限界式硬门槛）',
      'space_lixi_locked',
    );
  }
  if (!world.cultivationGate) {
    throw new WorldAssertionError('罗小黑世界包必须声明 cultivationGate 双闸', 'cultivation_gate_exists');
  }
  const [wMin, wMax] = world.cultivationGate.entryEventAgeWindow;
  if (wMin < 8 || wMax > 24) {
    throw new WorldAssertionError(
      `修行入口年龄窗必须在 [8, 24] 内（实际：[${wMin}, ${wMax}]），错过窗口终身凡人`,
      'entry_age_window',
    );
  }
  if (!world.hardThresholds?.multiSystemCap) {
    throw new WorldAssertionError('罗小黑世界包必须声明 multi_system_cap 多系上限', 'multi_system_cap');
  }
  const t2 = world.hardThresholds?.t2SpaceDeathBound;
  if (!t2 || t2.rule !== 'space_loss_equals_death') {
    throw new WorldAssertionError(
      '必须声明 t2_space_death_bound: space_loss_equals_death（失去空间系→灵质空间衰竭→死亡）',
      't2_space_death_bound',
    );
  }
  if (t2.exception !== 'dual_essence') {
    throw new WorldAssertionError('t2 唯一幸存通道必须为 dual_essence（双灵质）', 't2_exception');
  }
}
