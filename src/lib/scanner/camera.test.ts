import { describe, expect, it } from 'vitest';
import { addOnFrom } from './camera';

describe('addOnFrom', () => {
  it('finds the add-on attached to this ISBN', () => {
    expect(addOnFrom(['9780441172719', '978044117271951699'], '9780441172719')).toBe('51699');
    expect(addOnFrom(['9780441172719'], '9780441172719')).toBeUndefined();
    expect(addOnFrom(['978030640615751699'], '9780441172719')).toBeUndefined();
  });
});
