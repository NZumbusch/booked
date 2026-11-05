import { describe, expect, it } from 'vitest';
import { gilbert } from './gilbert';

describe('gilbert curve', () => {
  it('visits every cell of any rectangle once, always stepping to a neighbouring cell', () => {
    for (const [w, h] of [[1, 1], [2, 3], [7, 5], [18, 29], [33, 22], [16, 16], [5, 40]]) {
      const path = gilbert(w, h);
      expect(path).toHaveLength(w * h);
      expect(new Set(path.map(([x, y]) => `${x},${y}`)).size).toBe(w * h);
      expect(path.every(([x, y]) => x >= 0 && y >= 0 && x < w && y < h)).toBe(true);
      // odd sizes may need one diagonal step; never a jump
      for (let i = 1; i < path.length; i++) {
        const dx = Math.abs(path[i][0] - path[i - 1][0]), dy = Math.abs(path[i][1] - path[i - 1][1]);
        expect(Math.max(dx, dy)).toBe(1);
      }
    }
  });
});
