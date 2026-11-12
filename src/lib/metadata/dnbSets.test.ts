import { describe, expect, it } from 'vitest';
import { dnbSearch, dnbSetVolumes, parseDnbRecords, volumeNumber } from './dnb';
import { compareVolumeNumbers, groupSets, volumeDraft, volumeLabel } from './dnbSets';
import fontane from './fixtures/dnb-fontane-nymphenburger.xml?raw';
import bloch from './fixtures/dnb-bloch-stw554.xml?raw';

describe('DNB volumes of collected editions (Fontane, Sämtliche Werke, Nymphenburger 1959–1975)', () => {
  const hits = parseDnbRecords(fontane);

  it('reads every record once', () => {
    expect(hits.length).toBe(36);
  });

  it('finds the set and volume in the series field and in the title', () => {
    const stechlin = hits.find((h) => h.result.fields.title === 'Der Stechlin')!;
    expect(stechlin.set).toEqual({ title: 'Sämtliche Werke', number: '8' });
    expect(stechlin.result.fields.publisher).toBe('Nymphenburger Verlagshandlung');
    expect(stechlin.result.fields).toMatchObject({ series: 'Sämtliche Werke', seriesNumber: '8', publishedYear: 1959, authors: ['Theodor Fontane'] });
    // "Sämtliche Werke $n Bd. 23 [= Abt. 3 …]. $p Aufsätze zur bildenden Kunst / [Gesammelt …] $n T. 1"
    const kunst = hits.filter((h) => h.result.fields.title === 'Aufsätze zur bildenden Kunst');
    expect(kunst.map((h) => h.set)).toEqual([
      { title: 'Sämtliche Werke', number: '23', part: 'T. 1' },
      { title: 'Sämtliche Werke', number: '23', part: 'T. 2' }
    ]);
    // A volume of the "Wanderungen" inside the collected edition belongs to the edition (Bd. 9), not to the Wanderungen.
    const ruppin = hits.find((h) => h.result.fields.title === 'Die Grafschaft Ruppin')!;
    expect(ruppin.set).toEqual({ title: 'Sämtliche Werke', number: '9' });
  });

  it('drops the cataloguers’ notes and sorting marks from titles', () => {
    const titles = hits.map((h) => h.result.fields.title);
    expect(titles).toContain('Der Schleswig-Holsteinsche Krieg im Jahre 1864');
    expect(titles).toContain("L'Adultera");
  });

  it('groups the volumes into one set in volume order, without the records of the set itself', () => {
    const [set] = groupSets(hits);
    expect(set).toMatchObject({ title: 'Sämtliche Werke', author: 'Theodor Fontane', firstYear: 1959, lastYear: 1975 });
    expect(set.publisher).toMatch(/^Nymphenburger Verlagshandlung/);
    const numbers = set.volumes.map((v) => v.number);
    expect(numbers.slice(0, 13)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13']);
    expect(numbers.indexOf('13a')).toBe(numbers.indexOf('13') + 1);
    expect(set.volumes.every((v) => v.title !== 'Sämtliche Werke')).toBe(true);
  });

  it('makes a book draft per volume', () => {
    const [set] = groupSets(hits);
    const v = set.volumes.find((x) => x.number === '23' && x.part === 'T. 2')!;
    expect(volumeLabel(v)).toBe('Bd. 23, T. 2');
    expect(volumeDraft(v, 'Fontane, Sämtliche Werke')).toMatchObject({
      title: 'Aufsätze zur bildenden Kunst', series: 'Fontane, Sämtliche Werke', seriesNumber: '23', volume: '2', publishedYear: 1970
    });
  });
});

describe('volume numbers', () => {
  it('reads catalogue volume notes', () => {
    expect(volumeNumber('Bd. 24 : Abt. 3. Fontane als Autobiograph')).toBe('24');
    expect(volumeNumber('Bd. 23 [= Abt. 3. Fontane]')).toBe('23');
    expect(volumeNumber('Bd. 18a : Abt. 3')).toBe('18a');
    expect(volumeNumber('554')).toBe('554');
    expect(volumeNumber('..')).toBeUndefined();
  });

  it('sorts naturally', () => {
    expect(['10', '2', '13a', '13', 'Abt. 5', '1'].sort(compareVolumeNumbers)).toEqual(['1', '2', '10', '13', '13a', 'Abt. 5']);
  });

  it('a scholarly series number is no volume of an edition (Bloch: Werkausgabe Bd. 5 in stw 554)', () => {
    const [hit] = parseDnbRecords(bloch);
    expect(hit.set).toMatchObject({ title: 'Werkausgabe', number: '5' });
    expect(hit.result.fields.series).toBe('Suhrkamp-Taschenbuch Wissenschaft');
  });
});

describe('DNB queries', () => {
  it('free text becomes an AND of words, without CQL syntax', async () => {
    const urls: string[] = [];
    const f = async (url: string) => {
      urls.push(url);
      return new Response('<searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>');
    };
    expect(await dnbSearch('Fontane "Nymphenburger" or', f)).toEqual([]);
    expect(decodeURIComponent(urls[0])).toContain('query=woe=Fontane and woe=Nymphenburger sortBy jhr/sort.ascending&');
    expect(decodeURIComponent(urls[1])).toContain('query=woe=Fontane and woe=Nymphenburger&');
    await dnbSetVolumes({ title: 'Sämtliche Werke', author: 'Theodor Fontane', publisher: 'Nymphenburger Verlagshandlung' }, f);
    expect(decodeURIComponent(urls[2])).toContain('query=tit="Sämtliche Werke" and per=Fontane and vlg=Nymphenburger&');
  });
});
