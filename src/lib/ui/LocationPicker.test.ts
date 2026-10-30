import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';
import type { Location } from '../domain/types';
import LocationPicker from './LocationPicker.svelte';

const t = '2026-01-01T00:00:00.000Z';
const loc = (id: string, kind: Location['kind'], parentId: string | null, name: string): Location =>
  ({ id, kind, name, parentId, order: 0, createdAt: t, updatedAt: t });
const locations = [loc('a', 'place', null, 'Flat A'), loc('r', 'room', 'a', 'Study'), loc('s', 'shelf', 'r', 'Top')];

describe('LocationPicker', () => {
  it('only shows deeper levels once a parent is chosen', () => {
    render(LocationPicker, { locations, value: null });
    expect(screen.getByLabelText('Place')).toBeTruthy();
    expect(screen.queryByLabelText('Room')).toBeNull();
  });

  it('shows the full path of the current value', () => {
    render(LocationPicker, { locations, value: 's' });
    expect((screen.getByLabelText('Place') as HTMLSelectElement).value).toBe('a');
    expect((screen.getByLabelText('Room') as HTMLSelectElement).value).toBe('r');
    expect((screen.getByLabelText('Shelf') as HTMLSelectElement).value).toBe('s');
  });

  it('reveals rooms after picking a place', async () => {
    render(LocationPicker, { locations, value: null });
    await fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'a' } });
    expect(screen.getByLabelText('Room')).toBeTruthy();
  });

  it('hides excluded locations', () => {
    render(LocationPicker, { locations, value: null, exclude: ['a', 'r', 's'] });
    expect(screen.queryByRole('option', { name: 'Flat A' })).toBeNull();
  });
});
