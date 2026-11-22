// The Reaction routes through the real app: what they answer, beyond the permission
// matrix's allow and deny statuses.
import type { ReactionList, ThreadResponseList, ThreadView } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createStaffMember,
  insertChannel,
  insertReaction,
  insertThread,
  insertThreadResponse,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

const reactionCount = async (channelId: string) =>
  Number(
    (
      await asOwner((query) =>
        query<{ n: string }>('select count(*) as n from reaction where channel_id = $1', [
          channelId,
        ]),
      )
    ).rows[0]?.n,
  );

describe('Reaction routes', () => {
  let testApp: TestApp;
  beforeAll(() => {
    testApp = createTestApp();
  });
  afterAll(async () => {
    await testApp.close();
  });

  async function as(staff: StaffFixture) {
    const cookie = await signIn(testApp, staff);
    return (path: string, init: { method?: string } = {}) =>
      testApp.app.request(path, { method: init.method ?? 'GET', headers: jsonHeaders({ cookie }) });
  }

  /** A Channel with a member, a Thread by its Channel admin and a Thread Response on it. */
  async function scene() {
    const author = await createStaffMember();
    const member = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: author.id, channelAdmin: true }, { staffId: member.id }],
    });
    const thread = await insertThread({ channelId: channel.id, authorId: author.id });
    const response = await insertThreadResponse({
      threadId: thread.id,
      channelId: channel.id,
      authorId: author.id,
    });
    const threadPath = `/api/channels/${channel.id}/threads/${thread.id}`;
    return {
      author,
      member,
      channel,
      thread,
      response,
      threadPath,
      responsePath: `${threadPath}/responses/${response.id}`,
      asAuthor: await as(author),
      asMember: await as(member),
    };
  }

  const url = (base: string, emoji: string) => `${base}/reactions/${encodeURIComponent(emoji)}`;

  it('adds a reaction and answers with the Thread’s reactions, counted and marked as the actor’s', async () => {
    const { threadPath, asAuthor, asMember } = await scene();
    const first = await asAuthor(url(threadPath, '👍'), { method: 'PUT' });
    expect(first.status).toBe(200);
    expect(((await first.json()) as ReactionList).reactions).toEqual([
      { emoji: '👍', count: 1, reacted: true },
    ]);
    const second = await asMember(url(threadPath, '👍'), { method: 'PUT' });
    expect(((await second.json()) as ReactionList).reactions).toEqual([
      { emoji: '👍', count: 2, reacted: true },
    ]);
  });

  it('keeps one reaction per emoji per person: reacting twice changes nothing', async () => {
    const { channel, threadPath, asMember } = await scene();
    await asMember(url(threadPath, '🎉'), { method: 'PUT' });
    const again = await asMember(url(threadPath, '🎉'), { method: 'PUT' });
    expect(again.status).toBe(200);
    expect(((await again.json()) as ReactionList).reactions).toEqual([
      { emoji: '🎉', count: 1, reacted: true },
    ]);
    expect(await reactionCount(channel.id)).toBe(1);
  });

  it('lets one person react with several emoji, in the order they first appeared', async () => {
    const { threadPath, asMember, asAuthor } = await scene();
    await asMember(url(threadPath, '🎉'), { method: 'PUT' });
    await asMember(url(threadPath, '👍'), { method: 'PUT' });
    const list = (await (
      await asAuthor(url(threadPath, '👍'), { method: 'PUT' })
    ).json()) as ReactionList;
    expect(list.reactions).toEqual([
      { emoji: '🎉', count: 1, reacted: false },
      { emoji: '👍', count: 2, reacted: true },
    ]);
  });

  it('takes a reaction back, only the actor’s own, and again is fine', async () => {
    const { threadPath, asAuthor, asMember } = await scene();
    await asAuthor(url(threadPath, '👍'), { method: 'PUT' });
    await asMember(url(threadPath, '👍'), { method: 'PUT' });
    const removed = await asMember(url(threadPath, '👍'), { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(((await removed.json()) as ReactionList).reactions).toEqual([
      { emoji: '👍', count: 1, reacted: false },
    ]);
    const again = await asMember(url(threadPath, '👍'), { method: 'DELETE' });
    expect(((await again.json()) as ReactionList).reactions).toEqual([
      { emoji: '👍', count: 1, reacted: false },
    ]);
  });

  it('reacts to a Thread Response, apart from the Thread’s own reactions', async () => {
    const { threadPath, responsePath, asMember } = await scene();
    await asMember(url(threadPath, '👍'), { method: 'PUT' });
    const res = await asMember(url(responsePath, '🎉'), { method: 'PUT' });
    expect(((await res.json()) as ReactionList).reactions).toEqual([
      { emoji: '🎉', count: 1, reacted: true },
    ]);
  });

  it('shows reactions with the Thread and its Thread Responses, as the viewer sees them', async () => {
    const { threadPath, responsePath, asAuthor, asMember } = await scene();
    await asMember(url(threadPath, '👍'), { method: 'PUT' });
    await asAuthor(url(responsePath, '🎉'), { method: 'PUT' });

    const thread = (await (await asMember(threadPath)).json()) as ThreadView;
    expect(thread.reactions).toEqual([{ emoji: '👍', count: 1, reacted: true }]);
    expect(thread.canReact).toBe(true);

    const list = (await (await asMember(`${threadPath}/responses`)).json()) as ThreadResponseList;
    expect(list.responses[0]?.reactions).toEqual([{ emoji: '🎉', count: 1, reacted: false }]);
    expect(list.responses[0]?.canReact).toBe(true);
  });

  it('shows the Thread row’s reactions and whether the viewer may react', async () => {
    const { channel, threadPath, asMember } = await scene();
    await asMember(url(threadPath, '👍'), { method: 'PUT' });
    const page = (await (await asMember(`/api/channels/${channel.id}/threads`)).json()) as {
      threads: { reactions: unknown; canReact: boolean }[];
    };
    expect(page.threads[0]?.reactions).toEqual([{ emoji: '👍', count: 1, reacted: true }]);
    expect(page.threads[0]?.canReact).toBe(true);
  });

  it('says a Staff member who has not joined a Public channel cannot react', async () => {
    const { channel, thread } = await scene();
    const visitor = await createStaffMember();
    const asVisitor = await as(visitor);
    const view = (await (
      await asVisitor(`/api/channels/${channel.id}/threads/${thread.id}`)
    ).json()) as ThreadView;
    expect(view.canReact).toBe(false);
  });

  it('removes a Thread Response’s reactions, other people’s too, when it is deleted', async () => {
    const { channel, response, responsePath, asAuthor, asMember } = await scene();
    await asMember(url(responsePath, '👍'), { method: 'PUT' });
    await asAuthor(url(responsePath, '🎉'), { method: 'PUT' });
    expect((await asAuthor(responsePath, { method: 'DELETE' })).status).toBe(204);
    expect(await reactionCount(channel.id)).toBe(0);
    const list = (await (
      await asMember(`${responsePath.replace(`/${response.id}`, '')}`)
    ).json()) as ThreadResponseList;
    expect(list.responses[0]).toMatchObject({ isDeleted: true, reactions: [], canReact: false });
  });

  it('answers 404 for a deleted Thread Response', async () => {
    const { responsePath, asAuthor, asMember } = await scene();
    await asAuthor(responsePath, { method: 'DELETE' });
    expect((await asMember(url(responsePath, '👍'), { method: 'PUT' })).status).toBe(404);
  });

  it('removes a Thread’s reactions and its Thread Responses’ with it', async () => {
    const { channel, threadPath, responsePath, asAuthor, asMember } = await scene();
    await asMember(url(threadPath, '👍'), { method: 'PUT' });
    await asMember(url(responsePath, '👍'), { method: 'PUT' });
    expect((await asAuthor(threadPath, { method: 'DELETE' })).status).toBe(204);
    expect(await reactionCount(channel.id)).toBe(0);
  });

  it('answers 404 for a Thread Response of another Thread, or one that does not exist', async () => {
    const { channel, author, response, asMember } = await scene();
    const other = await insertThread({ channelId: channel.id, authorId: author.id });
    const otherPath = `/api/channels/${channel.id}/threads/${other.id}`;
    expect(
      (await asMember(url(`${otherPath}/responses/${response.id}`, '👍'), { method: 'PUT' }))
        .status,
    ).toBe(404);
    const missing = '00000000-0000-4000-8000-000000000999';
    expect(
      (await asMember(url(`${otherPath}/responses/${missing}`, '👍'), { method: 'PUT' })).status,
    ).toBe(404);
  });

  it.each([
    ['a word', 'yes'],
    ['two emoji', '👍🎉'],
    ['a letter', 'a'],
  ])('answers 400 for %s', async (_name, emoji) => {
    const { threadPath, asMember } = await scene();
    const res = await asMember(url(threadPath, emoji), { method: 'PUT' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { issues: { message: string }[] } };
    expect(body.error.issues[0]?.message).toBe('Pick a single emoji to react with.');
  });

  it('still shows reactions people left before they were Deactivated', async () => {
    const { channel, thread, member, threadPath, asAuthor } = await scene();
    await insertReaction({ channelId: channel.id, threadId: thread.id, staffId: member.id });
    const view = (await (await asAuthor(threadPath)).json()) as ThreadView;
    expect(view.reactions).toEqual([{ emoji: '👍', count: 1, reacted: false }]);
  });
});
