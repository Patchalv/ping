import { describe, expect, it } from 'vitest';
import { liveInvalidations } from './live-invalidations';

const channelId = '00000000-0000-4000-8000-0000000000c1';
const threadId = '00000000-0000-4000-8000-0000000000d1';
const threadResponseId = '00000000-0000-4000-8000-0000000000e1';
const staffId = '00000000-0000-4000-8000-0000000000a1';

describe('liveInvalidations', () => {
  it('refetches the sidebar and Browse channels for a new Channel', () => {
    expect(liveInvalidations({ kind: 'channel.created', channelId })).toEqual([
      ['channels', 'mine'],
      ['channels', 'browse'],
    ]);
  });

  it('refetches the Channel everywhere, its Threads, and Ping counts, when it changes', () => {
    // Joining, leaving and archiving change what the viewer may do on its Threads.
    expect(liveInvalidations({ kind: 'channel.changed', channelId })).toEqual([
      ['channels', 'detail', channelId],
      ['channels', 'mine'],
      ['channels', 'browse'],
      ['pings'],
      ['threads', 'list', channelId],
      ['threads', 'detail', channelId],
      ['threads', 'responses', channelId],
    ]);
  });

  it('refetches every Channel, Thread, Ping and Saved view when a Channel turns Private', () => {
    // Non-members lose it everywhere at once: the sidebar, Browse, its feed, Pings, Saved.
    expect(liveInvalidations({ kind: 'channel.made_private', channelId })).toEqual([
      ['channels'],
      ['threads'],
      ['pings'],
      ['saved'],
    ]);
  });

  it('refetches the Channel’s Thread feed for a new Thread', () => {
    expect(liveInvalidations({ kind: 'thread.created', channelId, threadId })).toEqual([
      ['threads', 'list', channelId],
    ]);
  });

  it('refetches the feed, the Thread view and the Pings and Saved views for a changed Thread', () => {
    // The Pings and Saved views show the same Thread rows: a new title, or Resolved.
    expect(liveInvalidations({ kind: 'thread.changed', channelId, threadId })).toEqual([
      ['threads', 'list', channelId],
      ['threads', 'detail', channelId, threadId],
      ['pings', 'list'],
      ['saved', 'list'],
    ]);
  });

  it('refetches the feed, the Thread view, Pings and Saved for a deleted Thread', () => {
    // Deleting a Thread drops its Pings and every Saved copy of it.
    expect(liveInvalidations({ kind: 'thread.deleted', channelId, threadId })).toEqual([
      ['threads', 'list', channelId],
      ['threads', 'detail', channelId, threadId],
      ['pings'],
      ['saved'],
    ]);
  });

  it.each(['thread_response.created', 'thread_response.changed'] as const)(
    'refetches the Thread Responses, the Thread view and the feed for %s',
    (kind) => {
      expect(liveInvalidations({ kind, channelId, threadId, threadResponseId })).toEqual([
        ['threads', 'responses', channelId, threadId],
        ['threads', 'detail', channelId, threadId],
        ['threads', 'list', channelId],
      ]);
    },
  );

  it('refetches the Pings view, its counts, the feed and the Thread for a Ping change', () => {
    expect(liveInvalidations({ kind: 'ping.changed', channelId, threadId })).toEqual([
      ['pings'],
      ['threads', 'list', channelId],
      ['threads', 'detail', channelId, threadId],
    ]);
  });

  it('refetches the Pings view, its counts and the feed when Pings change with no one Thread', () => {
    expect(liveInvalidations({ kind: 'ping.changed', channelId })).toEqual([
      ['pings'],
      ['threads', 'list', channelId],
    ]);
  });

  it('refetches every Channel, Thread, Ping and Saved Thread when the Staff member’s own memberships change', () => {
    // Leaving a Private channel drops their Saved Threads in it.
    expect(liveInvalidations({ kind: 'membership.changed', staffId })).toEqual([
      ['channels'],
      ['threads'],
      ['pings'],
      ['saved'],
    ]);
  });

  it('refetches the sidebar’s Sections when the Staff member’s own change', () => {
    expect(liveInvalidations({ kind: 'section.changed', staffId })).toEqual([['sections', 'mine']]);
  });

  it('refetches Saved, Pings, Thread rows and Channels when their Saved list or mutes change', () => {
    // Saving Acknowledges a Ping, and mutes show on the Channel, the sidebar and the Thread.
    expect(liveInvalidations({ kind: 'attention.changed', staffId })).toEqual([
      ['saved'],
      ['pings'],
      ['threads'],
      ['channels'],
    ]);
  });

  it('refetches everything that shows Staff members when one changes', () => {
    expect(liveInvalidations({ kind: 'staff.changed', staffId })).toEqual([
      ['staff'],
      ['channels'],
      ['threads'],
    ]);
  });
});
