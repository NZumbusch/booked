import { describe, expect, it } from 'vitest';
import { dnbByIsbn, parseDnbRecord, publisherSeries, uninvert } from './dnb';
import goldmann from './fixtures/dnb-9783442478415.xml?raw';
import vorleser from './fixtures/dnb-9783257229530.xml?raw';
import dtv from './fixtures/dnb-9783423130578.xml?raw';
import bloch from './fixtures/dnb-bloch-stw554.xml?raw';
import walser from './fixtures/dnb-9783518188354.xml?raw';
import { fakeFetch } from './testing';

// Hand-built from the MARC 21 / DNB SRU documentation; real recorded responses are in fixtures/dnb-*.xml.
const record = `<?xml version="1.0" encoding="UTF-8"?>
<searchRetrieveResponse xmlns="http://www.loc.gov/zing/srw/"><version>1.1</version><numberOfRecords>1</numberOfRecords>
<records><record><recordSchema>MARC21-xml</recordSchema><recordPacking>xml</recordPacking><recordData>
<record xmlns="http://www.loc.gov/MARC21/slim" type="Bibliographic">
  <controlfield tag="001">1234567890</controlfield>
  <datafield tag="020" ind1=" " ind2=" "><subfield code="a">9783518188354</subfield><subfield code="c">kart. : EUR 9.00 (DE), EUR 9.30 (AT), sfr 13.90 (freier Preis)</subfield></datafield>
  <datafield tag="041" ind1=" " ind2=" "><subfield code="a">ger</subfield></datafield>
  <datafield tag="100" ind1="1" ind2=" "><subfield code="a">Hesse, Hermann</subfield><subfield code="4">aut</subfield></datafield>
  <datafield tag="245" ind1="1" ind2="0"><subfield code="a">\u0098Der\u009C Steppenwolf</subfield><subfield code="b">Erzählung</subfield><subfield code="c">Hermann Hesse</subfield></datafield>
  <datafield tag="250" ind1=" " ind2=" "><subfield code="a">52. Auflage</subfield></datafield>
  <datafield tag="264" ind1=" " ind2="1"><subfield code="a">Berlin</subfield><subfield code="b">Suhrkamp</subfield><subfield code="c">2019</subfield></datafield>
  <datafield tag="300" ind1=" " ind2=" "><subfield code="a">288 Seiten</subfield></datafield>
  <datafield tag="490" ind1="1" ind2=" "><subfield code="a">Suhrkamp Taschenbuch</subfield><subfield code="v">175</subfield></datafield>
  <datafield tag="689" ind1="0" ind2="0"><subfield code="a">Identitätskrise</subfield></datafield>
  <datafield tag="700" ind1="1" ind2=" "><subfield code="a">Muster, Max</subfield><subfield code="4">aui</subfield></datafield>
</record></recordData></record></records></searchRetrieveResponse>`;

describe('DNB', () => {
  it('parses a MARC 21 record including the fixed German price', () => {
    const r = parseDnbRecord(record)!;
    expect(r.url).toBe('https://d-nb.info/1234567890');
    expect(r.fields).toMatchObject({
      title: 'Der Steppenwolf', subtitle: 'Erzählung', authors: ['Hermann Hesse'], contributors: ['Max Muster (introduction)'],
      publisher: 'Suhrkamp', publishedYear: 2019, edition: '52. Auflage', language: 'de', pageCount: 288,
      subjects: ['Identitätskrise'],
      listPrice: { amount: 9, currency: 'EUR', source: 'dnb' }
    });
  });

  it('returns undefined when the DNB has no record', async () => {
    expect(await dnbByIsbn('9780441172719', fakeFetch({}))).toBeUndefined();
    const none = async () => new Response('<searchRetrieveResponse><numberOfRecords>0</numberOfRecords></searchRetrieveResponse>');
    expect(await dnbByIsbn('9780441172719', none)).toBeUndefined();
  });

  it('un-inverts names', () => {
    expect(uninvert('Hesse, Hermann')).toBe('Hermann Hesse');
    expect(uninvert('Homer')).toBe('Homer');
  });

  describe('real DNB records', () => {
    const xml: Record<string, string> = { '9783518188354': walser, '9783442478415': goldmann, '9783257229530': vorleser, '9783423130578': dtv };
    const real = (isbn: string) => parseDnbRecord(xml[isbn])!.fields;

    it('Suhrkamp: price, editor, series', () => {
      const f = real('9783518188354');
      expect(f).toMatchObject({ title: 'Ein fliehendes Pferd', subtitle: 'Novelle', authors: ['Martin Walser'], publisher: 'Suhrkamp', publishedYear: 2002, pageCount: 163, language: 'de' });
      expect(f.listPrice).toEqual({ amount: 6.5, currency: 'EUR', source: 'dnb' });
      expect(f.contributors).toEqual(['Helmuth Kiesel (editor)']);
      expect(f.series).toBe('Suhrkamp-BasisBibliothek');
    });

    it('Goldmann: the (DE) price, translator from a German role, no original work as contributor, no catalogue number as series', () => {
      const f = real('9783442478415');
      expect(f.listPrice).toEqual({ amount: 9.99, currency: 'EUR', source: 'dnb' });
      expect(f.contributors).toEqual(['Barbara Röhl (translator)']);
      expect(f.series).toBeUndefined();
      expect(f.seriesNumber).toBeUndefined();
      expect(f.line).toBe('Goldmann');
    });

    it('older record: DM price preferred over Swiss francs; form terms dropped from subjects', () => {
      const f = real('9783257229530');
      expect(f.listPrice).toEqual({ amount: 14.9, currency: 'DEM', source: 'dnb' });
      expect(f.subjects).toContain('Konzentrationslager');
      expect(f.subjects).not.toContain('Belletristische Darstellung');
      expect(f.series).toBeUndefined();
    });

    it('dtv: publisher abbreviation spelled out', () => {
      const f = real('9783423130578');
      expect(f.publisher).toBe('Deutscher Taschenbuch-Verlag');
      expect(f.series).toBeUndefined();
    });
  });

  it('tells publisher catalogue numbers from real series', () => {
    expect(publisherSeries('Goldmann', '47841', 'Goldmann')).toBe(true);
    expect(publisherSeries('Fischer Taschenbuch', '12', 'S. Fischer')).toBe(true);
    expect(publisherSeries('Die Chroniken von Narnia', '3', 'Ueberreuter')).toBe(false);
    expect(publisherSeries('Suhrkamp-BasisBibliothek', '35', 'Suhrkamp')).toBe(false);
  });
});

describe('multi-volume work in a scholarly series (Bloch, stw 554)', () => {
  it('uses the part title, keeps the set and volume, and keeps the stw series', () => {
    const r = parseDnbRecord(bloch)!;
    expect(r.fields.title).toBe('Das Prinzip Hoffnung');
    expect(r.fields.subtitle).toBe('Werkausgabe, Bd. 5, Kap. 33 - 42');
    expect(r.fields.series).toBe('Suhrkamp-Taschenbuch Wissenschaft');
    expect(r.fields.seriesNumber).toBe('554');
  });
});
