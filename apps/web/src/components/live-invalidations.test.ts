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

  it('refetches the Channel everywhere, and Ping counts, when its membership changes', () => {
    expect(liveInvalidations({ kind: 'channel.changed', channelId })).toEqual([
      ['channels', 'detail', channelId],
      ['channels', 'mine'],
      ['channels', 'browse'],
      ['pings'],
    ]);
  });

  it('refetches the Channel’s Thread feed for a new Thread', () => {
    expect(liveInvalidations({ kind: 'thread.created', channelId, threadId })).toEqual([
      ['threads', 'list', channelId],
    ]);
  });

  it.each(['thread.changed', 'thread.deleted'] as const)(
    'refetches the feed and the Thread view for %s',
    (kind) => {
      expect(liveInvalidations({ kind, channelId, threadId })).toEqual([
        ['threads', 'list', channelId],
        ['threads', 'detail', channelId, threadId],
      ]);
    },
  );

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

  it('refetches every Channel, Thread and Ping when the Staff member’s own memberships change', () => {
    expect(liveInvalidations({ kind: 'membership.changed', staffId })).toEqual([
      ['channels'],
      ['threads'],
      ['pings'],
    ]);
  });

  it('refetches the sidebar’s Sections when the Staff member’s own change', () => {
    expect(liveInvalidations({ kind: 'section.changed', staffId })).toEqual([['sections', 'mine']]);
  });

  it('refetches everything that shows Staff members when one changes', () => {
    expect(liveInvalidations({ kind: 'staff.changed', staffId })).toEqual([
      ['staff'],
      ['channels'],
      ['threads'],
    ]);
  });
});
