<script lang="ts">
  import { DEFAULT_EUR_PER, DEM_PER_EUR } from '../domain/currency';
  import { attempt, library } from '../stores/app';

  const lib = library();
  let busy = $state(false);
  let error = $state('');
  const home = $derived($lib.settings.currency);
  const rates = $derived($lib.settings.rates);
  const updated = $derived(rates?.updatedAt ? rates.updatedAt.slice(0, 10) : undefined);

  /** Current euro reference rates (ECB, via frankfurter.dev). */
  async function fetchRates() {
    busy = true;
    error = '';
    try {
      const symbols = Object.keys(DEFAULT_EUR_PER).filter((c) => c !== 'EUR').join(',');
      const res = await fetch(`https://api.frankfurter.dev/v1/latest?base=EUR&symbols=${symbols}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { rates: Record<string, number> };
      const eurPer: Record<string, number> = { EUR: 1 };
      for (const [c, perEur] of Object.entries(body.rates)) if (perEur > 0) eurPer[c] = 1 / perEur;
      await attempt(() => lib.updateSettings({ rates: { eurPer, updatedAt: new Date().toISOString() } }), 'Exchange rates updated');
    } catch {
      error = navigator.onLine ? 'The rate service didn’t answer. The built-in rates stay in use.' : 'You’re offline.';
    } finally {
      busy = false;
    }
  }

  const shown = $derived(['USD', 'GBP', 'CHF'].filter((c) => c !== home));
  const rateText = (c: string) => `1 ${c} ≈ ${((rates?.eurPer[c] ?? DEFAULT_EUR_PER[c]) ?? 0).toFixed(2)} EUR`;
</script>

<section class="card stack">
  <h2>Exchange rates</h2>
  <p class="muted small">
    The collection value in Stats adds prices in different currencies together in {home}.
    German marks (older catalogue prices) use the fixed rate 1 EUR = {DEM_PER_EUR} DM.
    Other currencies use {updated ? `rates from ${updated}` : 'rough built-in rates'}: {shown.map(rateText).join(' · ')}.
  </p>
  {#if error}<p class="small err">{error}</p>{/if}
  <div><button disabled={busy} onclick={fetchRates}>{busy ? 'Fetching…' : 'Update rates'}</button></div>
</section>

<style>
  p { margin: 0; }
  .err { color: var(--danger); }
</style>
