import { parseMiniYaml } from './parse.ts';
import { validateWorld, WorldValidateError } from './validate.ts';
import { assertWorldPack, assertLuoXiaoHeiPack } from './assertions.ts';
import { validateNarratives } from './narratives.ts';
import type { World } from '../../engine/src/types.ts';

export class YamlParseError extends Error {
  constructor(message: string) {
    super(`YAML 解析失败：${message}`);
    this.name = 'YamlParseError';
  }
}

export interface CompileOptions {
  strict?: 'luoxiaohei';
}

export function compileWorldText(yamlText: string, source = '<string>', opts: CompileOptions = {}, narrativesText?: string): World {
  let raw: unknown;
  try {
    raw = parseMiniYaml(yamlText);
  } catch (e) {
    throw new YamlParseError(`${source}: ${(e as Error).message}`);
  }
  const world = validateWorld(raw);
  assertWorldPack(world);
  if (opts.strict === 'luoxiaohei') assertLuoXiaoHeiPack(world);
  if (narrativesText !== undefined && narrativesText.trim().length > 0) {
    let narrRaw: unknown;
    try {
      narrRaw = parseMiniYaml(narrativesText);
    } catch (e) {
      throw new YamlParseError(`narratives: ${(e as Error).message}`);
    }
    world.narratives = validateNarratives(narrRaw, world, source);
  }
  return world;
}

export { validateWorld, WorldValidateError, assertWorldPack, assertLuoXiaoHeiPack, validateNarratives };
