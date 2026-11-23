// The Thread list controls' choices (Status, Pings, sort and direction), kept per Channel
// in this browser only, so a new device starts from the defaults (product.md › A
// Channel's Thread list). Storage can be missing or blocked; the page works without it.
import { DEFAULT_THREAD_LIST_VIEW, type ThreadListView, threadListView } from '@ping/shared';
import { useState } from 'react';
import { readStored, writeStored } from '#/lib/storage';

export const threadListViewKey = (channelId: string) => `ping:thread-list:${channelId}`;

/** The Channel's kept view, or the defaults when there's none or it can't be read. */
export function readThreadListView(channelId: string): ThreadListView {
  const raw = readStored(threadListViewKey(channelId));
  if (raw === null) return DEFAULT_THREAD_LIST_VIEW;
  try {
    return threadListView.parse(JSON.parse(raw));
  } catch {
    return DEFAULT_THREAD_LIST_VIEW;
  }
}

export function saveThreadListView(channelId: string, view: ThreadListView) {
  writeStored(threadListViewKey(channelId), JSON.stringify(view));
}

/**
 * The Channel's view and a setter that keeps each change. Read once when the Channel
 * opens; the caller remounts per Channel.
 */
export function useThreadListView(channelId: string) {
  const [view, setView] = useState(() => readThreadListView(channelId));
  const change = (next: Partial<ThreadListView>) => {
    const merged = { ...view, ...next };
    saveThreadListView(channelId, merged);
    setView(merged);
  };
  return [view, change] as const;
}
