import { compileWorldText } from '../../dsl/src/compile.ts';
import { runBatch } from '../../engine/src/batch.ts';
import type { BatchStats } from '../../engine/src/types.ts';

interface BatchRequest {
  yaml: string;
  count: number;
  seedStart?: number;
  chunkSize?: number;
}

declare const self: {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
};

self.addEventListener('message', (ev: MessageEvent) => {
  const req = ev.data as BatchRequest;
  const world = compileWorldText(req.yaml, 'worlds/luoxiaohei/world.yaml', { strict: 'luoxiaohei' });
  const stats: BatchStats = runBatch(world, {
    count: req.count,
    seedStart: req.seedStart ?? 0,
    chunkSize: req.chunkSize ?? 1000,
    onProgress: (done, total) => {
      self.postMessage({ type: 'progress', done, total });
    },
  });
  self.postMessage({ type: 'done', stats });
});
