import { cleanTitle, displayTitle } from '../domain/book';
import { photoIdOf } from '../domain/photos';
import type { Book } from '../domain/types';
import { sortWishes } from '../domain/wishlist';
import { covers, library } from '../stores/app';

const W = 1080;
const PAD = 64;
const ROW = 210;
const COVER_W = 120;
const COVER_H = 180;
const MAX_ROWS = 60;

/** The cover as a drawable bitmap, from what's saved on this device (no network: works offline). */
async function coverBitmap(b: Book): Promise<ImageBitmap | undefined> {
  try {
    const id = photoIdOf(b.cover);
    if (id) {
      const p = await library().photo(id);
      return p ? await createImageBitmap(new Blob([p.data], { type: p.type })) : undefined;
    }
    return b.cover ? await covers().bitmap(b.cover) : undefined;
  } catch {
    return undefined;
  }
}

/** Break text into at most `max` lines of `width` px; the last one gets an ellipsis if cut. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width <= width) line = next;
    else {
      if (line) lines.push(line);
      line = w;
      if (lines.length === max) break;
    }
  }
  if (lines.length < max && line) lines.push(line);
  if (lines.length === max && words.join(' ') !== lines.join(' ')) {
    let last = lines[max - 1];
    while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
    lines[max - 1] = `${last}…`;
  }
  return lines.slice(0, max);
}

/** Your wishlist as a picture (PNG) with covers, titles, authors and notes, to send to family. */
export async function wishlistImage(books: Book[], heading = 'My wishlist'): Promise<Blob> {
  const list = sortWishes(books);
  const shown = list.slice(0, MAX_ROWS);
  const more = list.length - shown.length;
  const legend = list.some((b) => b.mustHave);
  const H = PAD + 90 + shown.length * ROW + (more ? 60 : 0) + (legend ? 60 : 0) + PAD;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const font = (size: number, weight = 400) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  ctx.fillStyle = '#f7f5f0';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1f2a37';
  ctx.font = font(56, 700);
  ctx.textBaseline = 'top';
  ctx.fillText(heading, PAD, PAD);

  const bitmaps = await Promise.all(shown.map(coverBitmap));
  shown.forEach((b, i) => {
    const y = PAD + 90 + i * ROW;
    const bmp = bitmaps[i];
    // cover, cropped to 2:3 like everywhere else
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(PAD, y, COVER_W, COVER_H, 8);
    ctx.clip();
    if (bmp) {
      const scale = Math.max(COVER_W / bmp.width, COVER_H / bmp.height);
      const w = bmp.width * scale, h = bmp.height * scale;
      ctx.drawImage(bmp, PAD + (COVER_W - w) / 2, y + (COVER_H - h) * 0.25, w, h);
    } else {
      const hue = [...b.title].reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) % 360, 7);
      ctx.fillStyle = `hsl(${hue} 35% 42%)`;
      ctx.fillRect(PAD, y, COVER_W, COVER_H);
      ctx.fillStyle = '#fff';
      // shrink until the longest word fits the tile
      const title = cleanTitle(b.title);
      let size = 18;
      ctx.font = font(size, 700);
      const longest = Math.max(...title.split(/\s+/).map((w) => ctx.measureText(w).width));
      if (longest > COVER_W - 20) {
        size = Math.max(11, Math.floor((size * (COVER_W - 20)) / longest));
        ctx.font = font(size, 700);
      }
      wrap(ctx, title, COVER_W - 20, 6).forEach((l, k) => ctx.fillText(l, PAD + 10, y + 12 + k * (size + 4)));
    }
    ctx.restore();
    bmp?.close?.();

    const x = PAD + COVER_W + 32;
    const width = W - x - PAD;
    let ty = y + 4;
    ctx.fillStyle = '#1f2a37';
    ctx.font = font(36, 700);
    for (const l of wrap(ctx, `${b.mustHave ? '★ ' : ''}${displayTitle(b)}`, width, 2)) {
      ctx.fillText(l, x, ty);
      ty += 44;
    }
    ctx.font = font(28);
    ctx.fillStyle = '#4b5563';
    const by = [b.authors.join(', '), b.publisher].filter(Boolean).join(' · ');
    if (by) {
      ctx.fillText(wrap(ctx, by, width, 1)[0], x, ty + 2);
      ty += 38;
    }
    if (b.notes?.trim()) {
      ctx.font = font(26);
      ctx.fillStyle = '#6b7280';
      for (const l of wrap(ctx, b.notes.trim(), width, 2)) {
        ctx.fillText(l, x, ty + 4);
        ty += 32;
      }
    }
  });
  let fy = PAD + 90 + shown.length * ROW;
  ctx.font = font(28);
  ctx.fillStyle = '#6b7280';
  if (more) {
    ctx.fillText(`…and ${more} more`, PAD, fy);
    fy += 60;
  }
  if (legend) ctx.fillText('★ = most wanted', PAD, fy);

  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Couldn’t make the picture'))), 'image/png'));
}
