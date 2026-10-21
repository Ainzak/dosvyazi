import { useState } from 'react';

// Keep lightweight metadata for recovery, but mount at most100 message/media rows.
export function useHistoryWindow<T extends { sequence: string; attachment?: unknown }>(messages: T[] | undefined) {
  const [start, setStart] = useState<string | null>(null); const all = messages ?? [];
  const found = start === null ? Math.max(0, all.length - 100) : all.findIndex(m => BigInt(m.sequence) >= BigInt(start));
  const index = found < 0 ? Math.max(0, all.length - 100) : found;
  return { messages: all.slice(index, index + 100), startIndex: index, total: all.length, earlier: index > 0, newer: index + 100 < all.length, media: all.some(m => m.attachment),
    first: (sequence?: string) => setStart(sequence ?? all[0]?.sequence ?? null), latest: () => setStart(null),
    previous: () => setStart(all[Math.max(0, index - 50)]?.sequence ?? null), next: () => setStart(index + 150 >= all.length ? null : all[index + 50]!.sequence) };
}
export function captureMessageAnchor(list: HTMLOListElement) {
  const top = list.getBoundingClientRect().top; const rows = [...list.querySelectorAll<HTMLElement>('[data-message-id]')];
  const first = rows.find(row => row.getBoundingClientRect().bottom > top);
  return first ? { id: first.dataset.messageId!, offset: first.getBoundingClientRect().top - top } : null;
}
export function restoreMessageAnchor(list: HTMLOListElement, anchor: NonNullable<ReturnType<typeof captureMessageAnchor>>) {
  const row = list.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.id)}"]`);
  if (row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.offset; else list.scrollTop = 0;
}
