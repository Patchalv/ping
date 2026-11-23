// What a live update refetches. An event names what changed, never its content, so open
// screens refetch it through the ordinary API: each event invalidates the query keys of
// every screen that shows it, and only screens on show refetch.
import type { LiveEvent } from '@ping/shared';
import type { QueryKey } from '@tanstack/react-query';
import { channelKeys } from '../features/channel/api';
import { sectionKeys } from '../features/section/api';
import { staffKeys } from '../features/staff/api';
import { pingKeys, threadKeys } from '../features/thread/api';

export function liveInvalidations(event: LiveEvent): QueryKey[] {
  switch (event.kind) {
    case 'channel.created':
      return [channelKeys.mine(), channelKeys.browse()];
    case 'channel.changed':
      // Includes losing access, which drops the Channel's Pings.
      return [
        channelKeys.detail(event.channelId),
        channelKeys.mine(),
        channelKeys.browse(),
        pingKeys.all,
      ];
    case 'membership.changed':
      // Left or removed: the Channel may now be hidden, wherever it shows.
      return [channelKeys.all, threadKeys.all, pingKeys.all];
    case 'thread.created':
      return [threadKeys.list(event.channelId)];
    case 'thread.changed':
      // The Pings view shows the same Thread rows: a new title, or Resolved.
      return [
        threadKeys.list(event.channelId),
        threadKeys.detail(event.channelId, event.threadId),
        pingKeys.list(),
      ];
    case 'thread.deleted':
      return [threadKeys.list(event.channelId), threadKeys.detail(event.channelId, event.threadId)];
    case 'thread_response.created':
    case 'thread_response.changed':
      return [
        threadKeys.responses(event.channelId, event.threadId),
        threadKeys.detail(event.channelId, event.threadId),
        threadKeys.list(event.channelId),
      ];
    case 'ping.changed':
      return [
        pingKeys.all,
        threadKeys.list(event.channelId),
        ...(event.threadId ? [threadKeys.detail(event.channelId, event.threadId)] : []),
      ];
    case 'section.changed':
      return [sectionKeys.mine()];
    case 'staff.changed':
      // Names and roles show in the Staff members list, member lists and bylines.
      return [staffKeys.all, channelKeys.all, threadKeys.all];
  }
}
