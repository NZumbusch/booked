import { describe, expect, it } from 'vitest';
import { addOnFrom, tapToImagePoint } from './camera';

describe('addOnFrom', () => {
  it('finds the add-on attached to this ISBN', () => {
    expect(addOnFrom(['9780441172719', '978044117271951699'], '9780441172719')).toBe('51699');
    expect(addOnFrom(['9780441172719'], '9780441172719')).toBeUndefined();
    expect(addOnFrom(['978030640615751699'], '9780441172719')).toBeUndefined();
  });
});

describe('tapToImagePoint', () => {
  it('maps taps through the cover crop', () => {
    // 16:9 video in a square box: the sides are cropped, so the box centre is the image centre
    expect(tapToImagePoint(100, 100, { w: 200, h: 200 }, { w: 1600, h: 900 })).toEqual({ x: 0.5, y: 0.5 });
    const left = tapToImagePoint(0, 0, { w: 200, h: 200 }, { w: 1600, h: 900 });
    expect(left.x).toBeCloseTo(0.219, 2);
    expect(left.y).toBe(0);
  });
});
