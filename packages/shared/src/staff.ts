// Staff members and invites: the request schemas both apps use, and the shapes the server
// answers with. Every rule a Staff member can trip has a plain-English message.
import { z } from 'zod';
import { newPassword } from './auth';

export const STAFF_NAME_MAX = 80;

const staffRole = z.enum(['admin', 'member'], { error: 'Choose Admin or Member.' });
export type StaffRole = z.infer<typeof staffRole>;

/** A display name, with the messages for whoever's typing (their own, or someone else's). */
const displayName = (messages: { empty: string; tooLong: string }) =>
  z
    .string({ error: messages.empty })
    .trim()
    .min(1, messages.empty)
    .max(STAFF_NAME_MAX, messages.tooLong);

/** An email address, stored lowercased, as Better Auth signs in with them. */
const emailAddress = (empty: string) =>
  z
    .string({ error: empty })
    .trim()
    .min(1, empty)
    .pipe(z.email({ error: 'Enter an email address like name@example.com.' }))
    .transform((email) => email.toLowerCase());

/** POST /api/staff/invites. */
export const inviteStaffBody = z.object({
  name: displayName({
    empty: 'Enter their name.',
    tooLong: `Keep the name to ${STAFF_NAME_MAX} characters or fewer.`,
  }),
  email: emailAddress('Enter their email address.'),
  role: staffRole,
});
export type InviteStaffBody = z.input<typeof inviteStaffBody>;

/** PATCH /api/staff/:staffId/role: an Admin changes someone else's company role. */
export const changeRoleBody = z.object({ role: staffRole });
export type ChangeRoleBody = z.input<typeof changeRoleBody>;

/** PATCH /api/staff/:staffId/name: your own display name. */
export const changeNameBody = z.object({
  name: displayName({
    empty: 'Enter your name.',
    tooLong: `Keep your name to ${STAFF_NAME_MAX} characters or fewer.`,
  }),
});
export type ChangeNameBody = z.input<typeof changeNameBody>;

/** What changing your display name answers. */
export type NameChanged = { id: string; name: string };

/** POST /api/staff/:staffId/email: asks for a link to the new address. */
export const changeEmailBody = z.object({ email: emailAddress('Enter your new email address.') });
export type ChangeEmailBody = z.input<typeof changeEmailBody>;

/** POST /api/email-change/confirm. The token travels in the body, never the URL. */
export const emailChangeTokenBody = z.object({
  token: z
    .string({ error: 'That link isn’t complete. Open it again from the email.' })
    .min(1, 'That link isn’t complete. Open it again from the email.')
    .max(2000, 'That link isn’t complete. Open it again from the email.'),
});

/** What confirming an email change answers: the address now in use. */
export type EmailChangeConfirmed = { email: string };

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
  password: newPassword,
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
