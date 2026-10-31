import { describe, expect, it } from 'vitest';
import { downloadDecision } from './policy';

describe('downloadDecision', () => {
  it('Wi-Fi only (default): downloads on Wi-Fi/ethernet, not on mobile data', () => {
    expect(downloadDecision('wifi', { type: 'wifi' })).toBe('yes');
    expect(downloadDecision('wifi', { type: 'ethernet' })).toBe('yes');
    expect(downloadDecision('wifi', { type: 'cellular' })).toBe('no');
  });
  it('asks when the browser can’t tell (iPhone)', () => {
    expect(downloadDecision('wifi', undefined)).toBe('ask');
    expect(downloadDecision('wifi', { type: 'unknown' })).toBe('ask');
  });
  it('respects data saver, offline and off', () => {
    expect(downloadDecision('any', { type: 'wifi', saveData: true })).toBe('no');
    expect(downloadDecision('any', { type: 'cellular' })).toBe('yes');
    expect(downloadDecision('wifi', { type: 'wifi' }, false)).toBe('no');
    expect(downloadDecision('off', { type: 'wifi' })).toBe('no');
  });
});
