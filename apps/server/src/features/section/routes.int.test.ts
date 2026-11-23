// The Section routes through the real app: what they answer, beyond the permission
// matrix's allow and deny statuses.
import type { SectionView } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaffMember, insertChannel, type StaffFixture } from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

describe('Section routes', () => {
  let testApp: TestApp;
  beforeAll(() => {
    testApp = createTestApp();
  });
  afterAll(async () => {
    await testApp.close();
  });

  async function as(staff: StaffFixture) {
    const cookie = await signIn(testApp, staff);
    return (path: string, init: { method?: string; body?: unknown } = {}) =>
      testApp.app.request(path, {
        method: init.method ?? 'GET',
        headers: jsonHeaders({ cookie }),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
  }

  /** A Staff member signed in, with a request helper and shortcuts for their Sections. */
  async function staffMember() {
    const staff = await createStaffMember();
    const request = await as(staff);
    const list = async () => (await (await request('/api/sections')).json()) as SectionView[];
    const create = async (name: string) => {
      const response = await request('/api/sections', { method: 'POST', body: { name } });
      expect(response.status).toBe(201);
      return (await response.json()) as SectionView;
    };
    const place = (channelId: string, sectionId: string | null, position?: number) =>
      request(`/api/channels/${channelId}/section`, {
        method: 'PUT',
        body: position === undefined ? { sectionId } : { sectionId, position },
      });
    return { staff, request, list, create, place };
  }

  const channelFor = (...staff: StaffFixture[]) =>
    insertChannel({
      members: staff.map((s, i) => ({ staffId: s.id, channelAdmin: i === 0 })),
    });

  it('starts with no Sections, and lists new ones in the order they were made', async () => {
    const me = await staffMember();
    expect(await me.list()).toEqual([]);
    const teaching = await me.create('  Teaching ');
    expect(teaching).toEqual({
      id: expect.any(String),
      name: 'Teaching',
      collapsed: false,
      channelIds: [],
    });
    await me.create('Building');
    expect((await me.list()).map((s) => s.name)).toEqual(['Teaching', 'Building']);
  });

  it('never shows one Staff member’s Sections to another', async () => {
    const me = await staffMember();
    const someoneElse = await staffMember();
    await me.create('Mine');
    expect(await someoneElse.list()).toEqual([]);
  });

  it('renames and collapses a Section', async () => {
    const me = await staffMember();
    const section = await me.create('Teaching');
    const renamed = await me.request(`/api/sections/${section.id}`, {
      method: 'PATCH',
      body: { name: 'Classes' },
    });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ name: 'Classes', collapsed: false });
    const collapsed = await me.request(`/api/sections/${section.id}`, {
      method: 'PATCH',
      body: { collapsed: true },
    });
    expect(await collapsed.json()).toMatchObject({ name: 'Classes', collapsed: true });
  });

  it('answers 404 for another Staff member’s Section, and changes nothing', async () => {
    const me = await staffMember();
    const someoneElse = await staffMember();
    const theirs = await someoneElse.create('Theirs');
    const rename = await me.request(`/api/sections/${theirs.id}`, {
      method: 'PATCH',
      body: { name: 'Mine now' },
    });
    expect(rename.status).toBe(404);
    const remove = await me.request(`/api/sections/${theirs.id}`, { method: 'DELETE' });
    expect(remove.status).toBe(404);
    expect((await someoneElse.list()).map((s) => s.name)).toEqual(['Theirs']);
  });

  it('reorders Sections', async () => {
    const me = await staffMember();
    const a = await me.create('A');
    const b = await me.create('B');
    const c = await me.create('C');
    const response = await me.request('/api/sections/order', {
      method: 'PUT',
      body: { sectionIds: [c.id, a.id, b.id] },
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as SectionView[]).map((s) => s.name)).toEqual(['C', 'A', 'B']);
    expect((await me.list()).map((s) => s.name)).toEqual(['C', 'A', 'B']);
  });

  it('refuses an order that leaves out a Section or names someone else’s', async () => {
    const me = await staffMember();
    const someoneElse = await staffMember();
    const a = await me.create('A');
    const b = await me.create('B');
    const theirs = await someoneElse.create('Theirs');
    for (const sectionIds of [[a.id], [a.id, b.id, theirs.id], [b.id, theirs.id]]) {
      const response = await me.request('/api/sections/order', {
        method: 'PUT',
        body: { sectionIds },
      });
      expect(response.status).toBe(409);
    }
    expect((await me.list()).map((s) => s.name)).toEqual(['A', 'B']);
  });

  it('places Channels in a Section, in order, and moves them between Sections', async () => {
    const me = await staffMember();
    const [one, two, three] = [
      await channelFor(me.staff),
      await channelFor(me.staff),
      await channelFor(me.staff),
    ];
    const teaching = await me.create('Teaching');
    const building = await me.create('Building');
    expect((await me.place(one.id, teaching.id)).status).toBe(204);
    expect((await me.place(two.id, teaching.id)).status).toBe(204);
    // At the front.
    expect((await me.place(three.id, teaching.id, 0)).status).toBe(204);
    expect((await me.list())[0]?.channelIds).toEqual([three.id, one.id, two.id]);
    // Within the same Section, to the end.
    await me.place(three.id, teaching.id, 2);
    expect((await me.list())[0]?.channelIds).toEqual([one.id, two.id, three.id]);
    // To another Section.
    await me.place(one.id, building.id);
    const sections = await me.list();
    expect(sections.map((s) => s.channelIds)).toEqual([[two.id, three.id], [one.id]]);
  });

  it('moves a Channel back to the default Channels section', async () => {
    const me = await staffMember();
    const channel = await channelFor(me.staff);
    const section = await me.create('Teaching');
    await me.place(channel.id, section.id);
    expect((await me.place(channel.id, null)).status).toBe(204);
    expect((await me.list())[0]?.channelIds).toEqual([]);
  });

  it('deletes a Section, moving its Channels back to the default Channels section', async () => {
    const me = await staffMember();
    const channel = await channelFor(me.staff);
    const section = await me.create('Teaching');
    await me.place(channel.id, section.id);
    const response = await me.request(`/api/sections/${section.id}`, { method: 'DELETE' });
    expect(response.status).toBe(204);
    expect(await me.list()).toEqual([]);
    // It can go into a new Section afresh.
    const again = await me.create('Again');
    expect((await me.place(channel.id, again.id)).status).toBe(204);
  });

  it('answers 404 for placing a Channel in someone else’s Section', async () => {
    const me = await staffMember();
    const someoneElse = await staffMember();
    const channel = await channelFor(me.staff, someoneElse.staff);
    const theirs = await someoneElse.create('Theirs');
    expect((await me.place(channel.id, theirs.id)).status).toBe(404);
    expect((await someoneElse.list())[0]?.channelIds).toEqual([]);
  });

  it('refuses a Public channel you haven’t joined, and hides a Private one', async () => {
    const me = await staffMember();
    const other = await createStaffMember();
    const section = await me.create('Teaching');
    const publicChannel = await insertChannel({
      members: [{ staffId: other.id, channelAdmin: true }],
    });
    const privateChannel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: other.id, channelAdmin: true }],
    });
    const refused = await me.place(publicChannel.id, section.id);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: {
        code: 'forbidden',
        message: 'Join this Channel to put it in one of your Sections.',
      },
    });
    expect((await me.place(privateChannel.id, section.id)).status).toBe(404);
  });

  it('drops a Channel’s placement when you leave it', async () => {
    const me = await staffMember();
    const admin = await createStaffMember();
    const channel = await channelFor(admin, me.staff);
    const section = await me.create('Teaching');
    await me.place(channel.id, section.id);
    const left = await me.request(`/api/channels/${channel.id}/leave`, { method: 'POST' });
    expect(left.status).toBe(204);
    expect((await me.list())[0]?.channelIds).toEqual([]);
  });

  it('drops a Channel’s placement when a Channel admin removes you', async () => {
    const me = await staffMember();
    const admin = await createStaffMember();
    const channel = await channelFor(admin, me.staff);
    const section = await me.create('Teaching');
    await me.place(channel.id, section.id);
    const asAdmin = await as(admin);
    const removed = await asAdmin(`/api/channels/${channel.id}/members/${me.staff.id}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(204);
    expect((await me.list())[0]?.channelIds).toEqual([]);
  });
});
