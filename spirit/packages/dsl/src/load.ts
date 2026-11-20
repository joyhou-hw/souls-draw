import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { compileWorldText, type CompileOptions } from './compile.ts';
import type { World } from '../../engine/src/types.ts';

export function loadWorldFile(path: string, opts: CompileOptions = {}): World {
  const text = readFileSync(path, 'utf-8');
  return compileWorldText(text, path, opts);
}

export function loadWorldPack(dir: string, opts: CompileOptions = {}): World {
  const worldPath = join(dir, 'world.yaml');
  const narrativesPath = join(dir, 'narratives.yaml');
  const text = readFileSync(worldPath, 'utf-8');
  const narrativesText = existsSync(narrativesPath) ? readFileSync(narrativesPath, 'utf-8') : undefined;
  return compileWorldText(text, worldPath, opts, narrativesText);
}
