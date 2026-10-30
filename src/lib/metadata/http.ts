export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export class HttpError extends Error {
  constructor(public status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
  }
}

/** GET JSON with a timeout. Returns undefined on 404 (= "not found"), throws on other failures. */
export async function getJson<T>(
  fetcher: Fetcher,
  url: string,
  { timeoutMs = 10000, headers }: { timeoutMs?: number; headers?: Record<string, string> } = {}
): Promise<T | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { signal: ctrl.signal, headers });
    if (res.status === 404) return undefined;
    if (!res.ok) throw new HttpError(res.status, url);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** First 4-digit year in a free-form date ("March 1987", "1990-09-01"). */
export function parseYear(text: string | undefined): number | undefined {
  const m = text?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return m ? Number(m[1]) : undefined;
}

/** Strip HTML tags/entities some providers put into descriptions. */
export function plainText(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || undefined;
}
