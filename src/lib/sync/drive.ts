import type { SyncData } from '../domain/sync';
import type { Fetcher } from '../metadata/http';
import { SyncAuthError, SyncConflict, type SyncTarget } from './target';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const SYNC_FILE = 'booked-library.json';

interface DriveFile {
  id: string;
  version: string;
}

/** The library file in the app's private Drive folder (appDataFolder: invisible in "My Drive"). */
export class DriveTarget implements SyncTarget {
  private fileId: string | undefined;

  constructor(private token: () => Promise<string>, private f: Fetcher = fetch.bind(globalThis)) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const res = await this.f(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${await this.token()}` } });
    if (res.status === 401 || res.status === 403) throw new SyncAuthError('Google Drive sign-in expired. Reconnect to continue syncing.');
    if (!res.ok) throw new Error(`Google Drive error ${res.status}`);
    return res;
  }

  private async find(): Promise<DriveFile | undefined> {
    const q = encodeURIComponent(`name='${SYNC_FILE}' and trashed=false`);
    const res = await this.call(`${API}?spaces=appDataFolder&q=${q}&fields=files(id,version)&orderBy=modifiedTime desc`);
    const file = ((await res.json()) as { files: DriveFile[] }).files[0];
    this.fileId = file?.id;
    return file;
  }

  async read(): Promise<{ data: SyncData; version: string } | undefined> {
    const file = await this.find();
    if (!file) return undefined;
    const body = await (await this.call(`${API}/${file.id}?alt=media`)).json();
    if (body?.app !== 'booked-sync' || !body.data) throw new Error('The sync file on Google Drive is not readable');
    return { data: body.data as SyncData, version: file.version };
  }

  async write(data: SyncData, expectedVersion: string | undefined): Promise<string> {
    const current = await this.find();
    if ((current?.version) !== expectedVersion) throw new SyncConflict();
    const content = JSON.stringify({ app: 'booked-sync', schemaVersion: 1, writtenAt: new Date().toISOString(), data });
    let res: Response;
    if (!current) {
      const boundary = 'booked' + Math.random().toString(36).slice(2);
      const body =
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
        JSON.stringify({ name: SYNC_FILE, parents: ['appDataFolder'], mimeType: 'application/json' }) +
        `\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
      res = await this.call(`${UPLOAD}?uploadType=multipart&fields=id,version`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
      });
    } else {
      res = await this.call(`${UPLOAD}/${current.id}?uploadType=media&fields=id,version`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: content
      });
    }
    const file = (await res.json()) as DriveFile;
    this.fileId = file.id;
    return file.version;
  }

  // ---- own cover photos: one file each (photo-<id>.jpg), next to the library file

  /** Photo ids on Drive → their file ids. */
  async listPhotos(): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const q = encodeURIComponent(`name contains '${PHOTO_FILE_PREFIX}' and trashed=false`);
    let page: string | undefined;
    do {
      const res = await this.call(`${API}?spaces=appDataFolder&q=${q}&fields=nextPageToken,files(id,name)&pageSize=1000${page ? `&pageToken=${page}` : ''}`);
      const body = (await res.json()) as { files: { id: string; name: string }[]; nextPageToken?: string };
      for (const f of body.files) {
        const id = photoIdFromFileName(f.name);
        if (id) out.set(id, f.id);
      }
      page = body.nextPageToken;
    } while (page);
    return out;
  }

  async uploadPhoto(id: string, data: ArrayBuffer, type: string): Promise<void> {
    const boundary = 'booked' + Math.random().toString(36).slice(2);
    const head =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      JSON.stringify({ name: `${PHOTO_FILE_PREFIX}${id}.jpg`, parents: ['appDataFolder'], mimeType: type }) +
      `\r\n--${boundary}\r\nContent-Type: ${type}\r\n\r\n`;
    const body = new Blob([head, data, `\r\n--${boundary}--`]);
    await this.call(`${UPLOAD}?uploadType=multipart&fields=id`, {
      method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    });
  }

  async downloadPhoto(fileId: string): Promise<{ data: ArrayBuffer; type: string }> {
    const res = await this.call(`${API}/${fileId}?alt=media`);
    return { data: await res.arrayBuffer(), type: res.headers.get('Content-Type')?.split(';')[0] || 'image/jpeg' };
  }
}

export const PHOTO_FILE_PREFIX = 'photo-';
export function photoIdFromFileName(name: string): string | undefined {
  return name.match(/^photo-([0-9a-f]{20})\.jpg$/)?.[1];
}
