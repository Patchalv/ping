// Staff members and invites: the request schemas both apps use, and the shapes the server
// answers with. Every rule a Staff member can trip has a plain-English message.
import { z } from 'zod';

export const STAFF_NAME_MAX = 80;
/** product.md › Sign-in: at least 12 characters, and not in a known breach. */
export const PASSWORD_MIN = 12;

const staffRole = z.enum(['admin', 'member'], { error: 'Choose Admin or Member.' });
export type StaffRole = z.infer<typeof staffRole>;

/** POST /api/staff/invites. Emails are stored lowercased, as Better Auth signs in with them. */
export const inviteStaffBody = z.object({
  name: z
    .string({ error: 'Enter their name.' })
    .trim()
    .min(1, 'Enter their name.')
    .max(STAFF_NAME_MAX, `Keep the name to ${STAFF_NAME_MAX} characters or fewer.`),
  email: z
    .string({ error: 'Enter their email address.' })
    .trim()
    .min(1, 'Enter their email address.')
    .pipe(z.email({ error: 'Enter an email address like name@example.com.' }))
    .transform((email) => email.toLowerCase()),
  role: staffRole,
});
export type InviteStaffBody = z.input<typeof inviteStaffBody>;

/** Routes under /api/staff/:staffId. */
export const staffParams = z.object({
  staffId: z.uuid({ error: 'That isn’t a Staff member.' }),
});

const inviteToken = z
  .string({ error: 'That invite link isn’t complete.' })
  .min(1, 'That invite link isn’t complete.')
  .max(200, 'That invite link isn’t complete.');

/** POST /api/invites/lookup. The token travels in the body, never the URL. */
export const inviteTokenBody = z.object({ token: inviteToken });

/** POST /api/invites/accept, and the set-password form. */
export const acceptInviteBody = z.object({
  token: inviteToken,
  // Not trimmed: spaces can be part of a password. The server also refuses a breached one.
  password: z
    .string({ error: 'Choose a password.' })
    .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
    .max(128, 'Keep the password to 128 characters or fewer.'),
});
export type AcceptInviteBody = z.input<typeof acceptInviteBody>;

export type StaffState = 'active' | 'invited' | 'deactivated';

/** One row on the Admins' Staff members screen. `invite` is set only while Invited. */
export type StaffMemberView = {
  id: string;
  name: string;
  email: string;
  role: StaffRole;
  state: StaffState;
  invite: { expired: boolean; emailFailed: boolean } | null;
};

/** The signed-in Staff member: what the SPA needs to show Admin-only controls. */
export type CurrentStaffMember = { id: string; role: StaffRole };

/** What the set-password page shows: the name, and the email read-only. */
export type InviteView = { name: string; email: string };
