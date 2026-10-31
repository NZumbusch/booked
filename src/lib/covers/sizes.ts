/** Stored cover resolution (longest side in px) and rough JPEG size per cover. */
export const COVER_SIZES = {
  small: { px: 360, kb: 20, label: 'Small' },
  medium: { px: 540, kb: 40, label: 'Medium' },
  large: { px: 900, kb: 100, label: 'Large' },
  xl: { px: 1350, kb: 230, label: 'Extra large' }
} as const;
export type CoverSize = keyof typeof COVER_SIZES;
export const DEFAULT_COVER_SIZE: CoverSize = 'medium';

/**
 * Estimated storage for `count` covers at `size`. When covers are already cached, their real
 * average (scaled by area to the chosen size) beats the rule-of-thumb figure.
 */
export function estimateBytes(count: number, size: CoverSize, measured?: { bytes: number; covers: number; px: number }): number {
  const perCover = measured && measured.covers >= 20
    ? (measured.bytes / measured.covers) * Math.min(4, (COVER_SIZES[size].px / measured.px) ** 2)
    : COVER_SIZES[size].kb * 1024;
  return Math.round(count * perCover);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/** Ask the source for a large enough image (Open Library has -S/-M/-L; Google a zoom level). */
export function sourceUrl(url: string, size: CoverSize): string {
  if (url.includes('covers.openlibrary.org')) return url.replace(/-[SML]\.jpg/, size === 'small' ? '-M.jpg' : '-L.jpg');
  if (url.includes('books.google.com') && COVER_SIZES[size].px > 400) return url.replace(/zoom=\d/, 'zoom=0');
  return url;
}
