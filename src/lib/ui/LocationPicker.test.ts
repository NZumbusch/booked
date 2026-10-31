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
    render(LocationPicker, { locations, value: null, oncreate: null });
    expect(screen.getByLabelText('Place')).toBeTruthy();
    expect(screen.queryByLabelText('Room')).toBeNull();
  });

  it('shows the full path of the current value', () => {
    render(LocationPicker, { locations, value: 's', oncreate: null });
    expect((screen.getByLabelText('Place') as HTMLSelectElement).value).toBe('a');
    expect((screen.getByLabelText('Room') as HTMLSelectElement).value).toBe('r');
    expect((screen.getByLabelText('Shelf') as HTMLSelectElement).value).toBe('s');
  });

  it('reveals rooms after picking a place', async () => {
    render(LocationPicker, { locations, value: null, oncreate: null });
    await fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'a' } });
    expect(screen.getByLabelText('Room')).toBeTruthy();
  });

  it('hides excluded locations', () => {
    render(LocationPicker, { locations, value: null, exclude: ['a', 'r', 's'], oncreate: null });
    expect(screen.queryByRole('option', { name: 'Flat A' })).toBeNull();
  });

  it('creates a place inline and selects it', async () => {
    const created: unknown[] = [];
    const oncreate = async (kind: Location['kind'], name: string, parentId: string | null) => {
      created.push([kind, name, parentId]);
      return loc('new', kind, parentId, name);
    };
    render(LocationPicker, { locations: [], value: null, oncreate });
    await fireEvent.change(screen.getByLabelText('Place'), { target: { value: '__new__' } });
    await fireEvent.input(screen.getByLabelText('New place name'), { target: { value: 'Flat B' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(created).toEqual([['place', 'Flat B', null]]);
  });

  it('offers a new room even when the place has none yet', async () => {
    render(LocationPicker, { locations: [loc('a', 'place', null, 'Flat A')], value: 'a', oncreate: async () => undefined });
    expect(screen.getByRole('option', { name: '+ New room…' })).toBeTruthy();
  });
});
