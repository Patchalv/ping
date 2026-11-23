import { describe, expect, it } from 'vitest';
import { RICH_TEXT_MESSAGES } from './rich-text';
import {
  DEFAULT_THREAD_LIST_VIEW,
  listThreadsQuery,
  startThreadBody,
  threadListView,
  threadParams,
} from './thread';

const body = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
};

describe('startThreadBody', () => {
  it('accepts a title and a description, trimming the title', () => {
    expect(startThreadBody.parse({ title: '  Broken heater ', body })).toEqual({
      title: 'Broken heater',
      body,
    });
  });

  it('defaults the description to an empty document', () => {
    expect(startThreadBody.parse({ title: 'Broken heater' }).body).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    });
  });

  it.each([
    ['no title', { body }, 'title', 'Give the Thread a title.'],
    ['an empty title', { title: '', body }, 'title', 'Give the Thread a title.'],
    ['a title of only spaces', { title: '   ', body }, 'title', 'Give the Thread a title.'],
    [
      'a title over 200 characters',
      { title: 'x'.repeat(201), body },
      'title',
      'Keep the title to 200 characters or fewer.',
    ],
    [
      'a description outside the allowlist',
      { title: 'x', body: { type: 'doc', content: [{ type: 'horizontalRule' }] } },
      'body',
      RICH_TEXT_MESSAGES.notAllowed,
    ],
  ])('refuses %s, saying why', (_name, input, path, message) => {
    const result = startThreadBody.safeParse(input);
    expect(
      result.success ? [] : result.error.issues.map((i) => [i.path.join('.'), i.message]),
    ).toEqual([[path, message]]);
  });
});

describe('threadParams', () => {
  it('needs a Channel ID and a Thread ID', () => {
    const ids = {
      channelId: '00000000-0000-4000-8000-000000000001',
      threadId: '00000000-0000-4000-8000-000000000002',
    };
    expect(threadParams.parse(ids)).toEqual(ids);
    expect(threadParams.safeParse({ ...ids, threadId: 'x' }).error?.issues[0]?.message).toBe(
      'That isn’t a Thread link.',
    );
  });
});

describe('listThreadsQuery', () => {
  it('takes an optional Thread ID to load the page after', () => {
    expect(listThreadsQuery.parse({}).after).toBeUndefined();
    expect(listThreadsQuery.safeParse({ after: 'x' }).success).toBe(false);
  });

  it('defaults to Open Threads, with or without Pings, by Latest activity, newest first', () => {
    expect(listThreadsQuery.parse({})).toEqual(DEFAULT_THREAD_LIST_VIEW);
    expect(DEFAULT_THREAD_LIST_VIEW).toEqual({
      status: 'open',
      pings: 'all',
      sort: 'latest_activity',
      direction: 'desc',
    });
  });

  it('takes every Status, Pings, sort and direction choice', () => {
    expect(
      listThreadsQuery.parse({
        status: 'resolved',
        pings: 'with',
        sort: 'date_started',
        direction: 'asc',
      }),
    ).toEqual({ status: 'resolved', pings: 'with', sort: 'date_started', direction: 'asc' });
    expect(listThreadsQuery.parse({ status: 'all' }).status).toBe('all');
  });

  it.each([
    ['status', 'closed'],
    ['pings', 'unread'],
    ['sort', 'title'],
    ['direction', 'sideways'],
  ])('refuses an unknown %s', (key, value) => {
    expect(listThreadsQuery.safeParse({ [key]: value }).success).toBe(false);
  });
});

describe('threadListView', () => {
  it('reads back a stored view', () => {
    const view = { status: 'all', pings: 'with', sort: 'date_started', direction: 'asc' };
    expect(threadListView.parse(view)).toEqual(view);
  });

  it('fills a choice missing from an older stored view with its default', () => {
    expect(threadListView.parse({ status: 'resolved' })).toEqual({
      ...DEFAULT_THREAD_LIST_VIEW,
      status: 'resolved',
    });
  });
});
