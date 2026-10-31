/** Hand a file to the user: the share sheet on phones (→ Drive, Files, mail…), a download elsewhere. */
export async function saveFile(file: File, { share = true }: { share?: boolean } = {}): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (share && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // any other failure: fall through to a download
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}

export function stamp(date = new Date()): string {
  return date.toISOString().slice(0, 16).replace('T', '-').replace(':', '');
}
