export type CacheMode = 'wifi' | 'any' | 'off';

/** What the browser tells us about the connection (Network Information API; Android Chrome only). */
export interface ConnectionInfo {
  type?: string;
  saveData?: boolean;
}

/**
 * Should covers be downloaded now?
 * yes = go ahead; no = don't; ask = we can't tell if this is Wi-Fi (e.g. iPhone), let the user decide.
 */
export function downloadDecision(mode: CacheMode, conn: ConnectionInfo | undefined, online = true): 'yes' | 'no' | 'ask' {
  if (mode === 'off' || !online) return 'no';
  if (conn?.saveData) return 'no';
  if (mode === 'any') return 'yes';
  if (!conn?.type || conn.type === 'unknown') return 'ask';
  return conn.type === 'wifi' || conn.type === 'ethernet' ? 'yes' : 'no';
}

export function currentConnection(): ConnectionInfo | undefined {
  const c = (navigator as Navigator & { connection?: ConnectionInfo }).connection;
  return c ? { type: c.type, saveData: c.saveData } : undefined;
}
