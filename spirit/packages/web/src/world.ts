import worldYaml from '../../../worlds/luoxiaohei/world.yaml?raw';
import narrativesYaml from '../../../worlds/luoxiaohei/narratives.yaml?raw';
import { compileWorldText } from '../../dsl/src/compile.ts';
import type { World } from '../../engine/src/types.ts';

export { worldYaml };

export const world: World = compileWorldText(
  worldYaml,
  'worlds/luoxiaohei/world.yaml',
  { strict: 'luoxiaohei' },
  narrativesYaml,
);

export const worldMilestones: string[] = world.narrativeFeed?.milestones ?? [];
