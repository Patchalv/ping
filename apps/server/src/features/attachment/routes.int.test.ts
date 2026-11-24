// Attachments through the real app and the local MinIO: adding a file while writing,
// attaching it when the post is saved, and opening it, beyond the permission matrix's
// statuses.
import { readFileSync } from 'node:fs';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MESSAGES,
  type AttachmentView,
  type ThreadPage,
  type ThreadResponseList,
  type ThreadView,
} from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createStaffMember,
  databaseSnapshot,
  insertChannel,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, formHeaders, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const photo = readFileSync(new URL('./fixtures/with-metadata.jpg', import.meta.url));

describe('Attachments', () => {
  let testApp: TestApp;
  beforeAll(() => {
    testApp = createTestApp();
  });
  afterAll(async () => {
    await testApp.close();
  });

  async function as(staff: StaffFixture) {
    const cookie = await signIn(testApp, staff);
    const request = (path: string, init: { method?: string; body?: unknown } = {}) =>
      testApp.app.request(path, {
        method: init.method ?? 'GET',
        headers: jsonHeaders({ cookie }),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    const add = (channelId: string, name: string, content: Uint8Array | string) => {
      const form = new FormData();
      form.set('file', new File([content], name));
      return testApp.app.request(`/api/channels/${channelId}/attachments`, {
        method: 'POST',
        headers: formHeaders({ cookie }),
        body: form,
      });
    };
    return { request, add };
  }

  async function channelWith(visibility: 'public' | 'private', ...members: StaffFixture[]) {
    const author = await createStaffMember();
    const channel = await insertChannel({
      visibility,
      members: [
        { staffId: author.id, channelAdmin: true },
        ...members.map((m) => ({ staffId: m.id })),
      ],
    });
    return { author, channel };
  }

  /** Follows the redirect to the signed link and fetches the stored file. */
  async function download(res: Response) {
    expect(res.status).toBe(302);
    const location = res.headers.get('location');
    if (!location) throw new Error('no redirect');
    return fetch(location);
  }

  it('adds a pending file, strips its metadata, and opens it only for its uploader', async () => {
    const { author, channel } = await channelWith('public');
    const other = await createStaffMember();
    const { add, request } = await as(author);

    const res = await add(channel.id, 'desk.jpg', photo);
    expect(res.status).toBe(201);
    const added = (await res.json()) as AttachmentView;
    expect(added).toMatchObject({
      filename: 'desk.jpg',
      contentType: 'image/jpeg',
      isImage: true,
    });

    const opened = await request(`/api/attachments/${added.id}`);
    expect(opened.headers.get('x-content-type-options')).toBe('nosniff');
    const location = new URL(opened.headers.get('location') ?? '');
    expect(Number(location.searchParams.get('X-Amz-Expires'))).toBeLessThan(5 * 60);
    const stored = await download(opened);
    expect(stored.headers.get('content-type')).toBe('image/jpeg');
    expect(stored.headers.get('content-disposition')).toMatch(/^inline; filename="desk.jpg"/);
    const bytes = Buffer.from(await stored.arrayBuffer());
    expect(bytes.length).toBe(added.sizeBytes);
    for (const trace of ['Exif', 'PingTestCamera', 'xmpmeta', 'Ping test comment']) {
      expect(bytes.includes(trace)).toBe(false);
    }

    // Pending: nobody else can open it, or even tell it exists.
    const otherOpens = await (await as(other)).request(`/api/attachments/${added.id}`);
    expect(otherOpens.status).toBe(404);
  });

  it('stores a file under a random key, never its filename, and downloads it as an attachment', async () => {
    const { author, channel } = await channelWith('public');
    const { add, request } = await as(author);
    const added = (await (await add(channel.id, 'Rota juny.csv', 'name,room\n')).json()) as AttachmentView;

    const stored = await asOwner((query) =>
      query<{ object_key: string; original_filename: string }>(
        'select object_key, original_filename from attachment where id = $1',
        [added.id],
      ),
    );
    const row = stored.rows[0];
    expect(row?.original_filename).toBe('Rota juny.csv');
    const res = await request(`/api/attachments/${added.id}`);
    expect(new URL(res.headers.get('location') ?? '').pathname).toBe(
      `/ping-attachments/${row?.object_key}`,
    );
    const file = await download(res);
    expect(file.headers.get('content-type')).toBe('text/csv');
    expect(file.headers.get('content-disposition')).toMatch(/^attachment; filename="Rota juny.csv"/);
  });

  it.each([
    ['a HEIC photo', 'IMG_0001.HEIC', 'ftypheic', ATTACHMENT_MESSAGES.heic],
    ['a type that isn’t allowed', 'setup.exe', 'MZ', ATTACHMENT_MESSAGES.notAllowed],
    ['HTML named as an image', 'cat.png', '<script>alert(1)</script>', ATTACHMENT_MESSAGES.mismatch],
    [
      'a broken image',
      'desk.jpg',
      Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x40]),
      'This image is damaged, so Ping can’t take it. Choose another.',
    ],
  ])('refuses %s on the file field, storing nothing', async (_case, name, content, message) => {
    const { author, channel } = await channelWith('public');
    const { add } = await as(author);
    const before = await databaseSnapshot();
    const res = await add(channel.id, name, content);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: 'validation', message, issues: [{ path: 'file', message }] },
    });
    expect(await databaseSnapshot()).toEqual(before);
  });

  it('refuses a file over 20 MB', async () => {
    const { author, channel } = await channelWith('public');
    const { add } = await as(author);
    const res = await add(channel.id, 'big.txt', 'a'.repeat(ATTACHMENT_MAX_BYTES + 1));
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      ATTACHMENT_MESSAGES.tooLarge,
    );
  });

  it('attaches pending files when a Thread is started, and shows them to its readers', async () => {
    const reader = await createStaffMember();
    const { author, channel } = await channelWith('private', reader);
    const { add, request } = await as(author);
    const ids: string[] = [];
    for (const name of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
      ids.push(((await (await add(channel.id, name, name)).json()) as AttachmentView).id);
    }

    const started = await request(`/api/channels/${channel.id}/threads`, {
      method: 'POST',
      body: { title: 'Rota', body: doc('Attached.'), attachmentIds: ids },
    });
    expect(started.status).toBe(201);
    const thread = (await started.json()) as ThreadView;
    expect(thread.attachments.map((a) => a.filename)).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt']);

    // A reader opens them; the Thread row shows the first three and the count.
    const readerApi = (await as(reader)).request;
    expect((await readerApi(`/api/attachments/${ids[0]}`)).status).toBe(302);
    const page = (await (await readerApi(`/api/channels/${channel.id}/threads`)).json()) as ThreadPage;
    const row = page.threads.find((t) => t.id === thread.id);
    expect(row?.attachments.map((a) => a.filename)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(row?.attachmentCount).toBe(4);

    // A non-member, Admin or not, gets 404 for a Private channel’s Attachment.
    for (const outsider of [await createStaffMember(), await createStaffMember({ role: 'admin' })]) {
      expect((await (await as(outsider)).request(`/api/attachments/${ids[0]}`)).status).toBe(404);
    }

    // An Attachment already attached can't be attached again.
    const again = await request(`/api/channels/${channel.id}/threads`, {
      method: 'POST',
      body: { title: 'Again', body: doc('Again.'), attachmentIds: [ids[0]] },
    });
    expect(again.status).toBe(403);
  });

  it('refuses attaching someone else’s pending file, changing nothing', async () => {
    const other = await createStaffMember();
    const { author, channel } = await channelWith('public', other);
    const theirs = (await (await (await as(other)).add(channel.id, 'x.txt', 'x')).json()) as AttachmentView;

    const { request } = await as(author);
    const before = await databaseSnapshot();
    const res = await request(`/api/channels/${channel.id}/threads`, {
      method: 'POST',
      body: { title: 'Mine', body: doc('Mine.'), attachmentIds: [theirs.id] },
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      ATTACHMENT_MESSAGES.unavailable,
    );
    expect(await databaseSnapshot()).toEqual(before);
  });

  it('adds Attachments in an edit, up to 5 on one post', async () => {
    const { author, channel } = await channelWith('public');
    const { add, request } = await as(author);
    const addOne = async (name: string) =>
      ((await (await add(channel.id, name, name)).json()) as AttachmentView).id;
    const first = [await addOne('1.txt'), await addOne('2.txt'), await addOne('3.txt')];
    const thread = (await (
      await request(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: { title: 'Rota', body: doc('Three.'), attachmentIds: first },
      })
    ).json()) as ThreadView;

    const three = [await addOne('4.txt'), await addOne('5.txt'), await addOne('6.txt')];
    const tooMany = await request(`/api/channels/${channel.id}/threads/${thread.id}`, {
      method: 'PATCH',
      body: { title: 'Rota', body: doc('Six.'), attachmentIds: three },
    });
    expect(tooMany.status).toBe(403);
    expect(((await tooMany.json()) as { error: { message: string } }).error.message).toBe(
      ATTACHMENT_MESSAGES.tooMany,
    );

    const edited = await request(`/api/channels/${channel.id}/threads/${thread.id}`, {
      method: 'PATCH',
      body: { title: 'Rota', body: doc('Five.'), attachmentIds: three.slice(0, 2) },
    });
    expect(edited.status).toBe(200);
    expect(((await edited.json()) as ThreadView).attachments).toHaveLength(5);
  });

  it('attaches to a Thread Response, and hides them once it’s deleted', async () => {
    const { author, channel } = await channelWith('public');
    const { add, request } = await as(author);
    const thread = (await (
      await request(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: { title: 'Rota', body: doc('Start.') },
      })
    ).json()) as ThreadView;
    const added = (await (await add(channel.id, 'r.pdf', '%PDF-1.7\n')).json()) as AttachmentView;
    const responses = `/api/channels/${channel.id}/threads/${thread.id}/responses`;
    const sent = await request(responses, {
      method: 'POST',
      body: { body: doc('Here.'), attachmentIds: [added.id] },
    });
    expect(sent.status).toBe(201);
    const sentId = ((await sent.json()) as { id: string }).id;

    const list = (await (await request(responses)).json()) as ThreadResponseList;
    expect(list.responses[0]?.attachments.map((a) => a.filename)).toEqual(['r.pdf']);

    expect((await request(`${responses}/${sentId}`, { method: 'DELETE' })).status).toBe(204);
    const after = (await (await request(responses)).json()) as ThreadResponseList;
    expect(after.responses[0]?.attachments).toEqual([]);
    expect((await request(`/api/attachments/${added.id}`)).status).toBe(404);
  });
});
