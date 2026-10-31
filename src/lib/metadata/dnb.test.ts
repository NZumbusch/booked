import { describe, expect, it } from 'vitest';
import { dnbByIsbn, parseDnbRecord, uninvert } from './dnb';
import { fakeFetch } from './testing';

// Hand-built from the MARC 21 / DNB SRU documentation (not a recorded live response).
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
      series: 'Suhrkamp Taschenbuch', seriesNumber: '175', subjects: ['Identitätskrise'],
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
});
