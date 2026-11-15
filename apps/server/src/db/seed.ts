// Fake Spark Staff members for local development and the Playwright suite. Never real data.
//
// Every seeded Staff member signs in with SEED_PASSWORD (also in .env.example):
//
//   marta.ruiz@example.com     Admin
//   jordi.puig@example.com     Member
//   laura.gomez@example.com    Member
//   pablo.serra@example.com    Member
//   carlos.vidal@example.com   Deactivated Member (sign-in is refused)
//
// And three Channels (SEED_CHANNELS). "Owners" is Private, and neither Marta (the Admin)
// nor Pablo is a member, so opening it as them answers 404.
import { hashPassword } from 'better-auth/crypto';
import pg from 'pg';

export const SEED_PASSWORD = 'ping-local-dev-password';

type SeedStaff = {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
  deactivated?: boolean;
};

export const SEED_STAFF: readonly SeedStaff[] = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Marta Ruiz',
    email: 'marta.ruiz@example.com',
    role: 'admin',
  },
  {
    id: '00000000-0000-4000-8000-000000000002',
    name: 'Jordi Puig',
    email: 'jordi.puig@example.com',
    role: 'member',
  },
  {
    id: '00000000-0000-4000-8000-000000000003',
    name: 'Laura Gómez',
    email: 'laura.gomez@example.com',
    role: 'member',
  },
  {
    id: '00000000-0000-4000-8000-000000000004',
    name: 'Pablo Serra',
    email: 'pablo.serra@example.com',
    role: 'member',
  },
  {
    id: '00000000-0000-4000-8000-000000000005',
    name: 'Carlos Vidal',
    email: 'carlos.vidal@example.com',
    role: 'member',
    deactivated: true,
  },
];

const ADMIN_ID = '00000000-0000-4000-8000-000000000001';

type SeedChannel = {
  id: string;
  name: string;
  description: string;
  visibility: 'public' | 'private';
  /** The first member is the Channel's creator and its Channel admin. */
  members: readonly { email: string }[];
};

export const SEED_CHANNELS: readonly SeedChannel[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    name: 'Front desk',
    description: 'Reception, visitors and the day’s arrivals.',
    visibility: 'public',
    members: [
      { email: 'marta.ruiz@example.com' },
      { email: 'jordi.puig@example.com' },
      { email: 'laura.gomez@example.com' },
      { email: 'pablo.serra@example.com' },
    ],
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    name: 'Owners',
    description: 'Contracts and budgets. Owners only.',
    visibility: 'private',
    members: [{ email: 'jordi.puig@example.com' }, { email: 'laura.gomez@example.com' }],
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    name: 'Teaching',
    description: 'Timetables, cover and course materials.',
    visibility: 'public',
    members: [{ email: 'laura.gomez@example.com' }, { email: 'jordi.puig@example.com' }],
  },
];

const staffIdByEmail = (email: string): string => {
  const staff = SEED_STAFF.find((s) => s.email === email);
  if (!staff) throw new Error(`No seeded Staff member ${email}`);
  return staff.id;
};

/**
 * Inserts the seed Staff members and Channels as the owner role, skipping any already
 * there. Public
 * sign-up is off, so this writes Better Auth's user and account rows directly.
 */
export async function seed(ownerUrl: string): Promise<void> {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    const passwordHash = await hashPassword(SEED_PASSWORD);
    await client.query('begin');
    for (const staff of SEED_STAFF) {
      const inserted = await client.query(
        `insert into "user" (id, name, email, email_verified) values ($1, $2, $3, true)
         on conflict (email) do nothing`,
        [staff.id, staff.name, staff.email],
      );
      if (inserted.rowCount === 0) continue;
      await client.query(
        `insert into account (account_id, provider_id, user_id, password)
         values ($1, 'credential', $2, $3)`,
        [staff.id, staff.id, passwordHash],
      );
      await client.query(
        `insert into staff_member (id, role, invited_by, joined_at) values ($1, $2, $3, now())`,
        [staff.id, staff.role, staff.id === ADMIN_ID ? null : ADMIN_ID],
      );
      if (staff.deactivated) {
        await client.query(
          'update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1',
          [staff.id, ADMIN_ID],
        );
      }
    }
    for (const channel of SEED_CHANNELS) {
      const [creator, ...others] = channel.members.map((m) => staffIdByEmail(m.email));
      const inserted = await client.query(
        `insert into channel (id, name, description, visibility, created_by)
         values ($1, $2, $3, $4, $5) on conflict (id) do nothing`,
        [channel.id, channel.name, channel.description, channel.visibility, creator],
      );
      if (inserted.rowCount === 0) continue;
      await client.query(
        `insert into channel_member (channel_id, staff_id, is_channel_admin) values ($1, $2, true)`,
        [channel.id, creator],
      );
      for (const staffId of others) {
        await client.query(`insert into channel_member (channel_id, staff_id) values ($1, $2)`, [
          channel.id,
          staffId,
        ]);
      }
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    await client.end();
  }
}
