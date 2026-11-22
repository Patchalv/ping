// The Staff member feature's API: a query-key factory and hooks only. Components use these
// hooks and never call hc or read a response themselves. Mutations invalidate by key.
import type {
  AcceptInviteBody,
  ChangeEmailBody,
  ChangeNameBody,
  ChangeRoleBody,
  CurrentStaffMember,
  EmailChangeConfirmed,
  InviteStaffBody,
  InviteView,
  NameChanged,
  StaffMemberView,
} from '@ping/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { call } from '../../lib/api-client';

const staff = api.api.staff;
const invites = api.api.invites;

/**
 * The query keys. Exported so live updates (#47) can refetch the list by key.
 * @public
 */
export const staffKeys = {
  all: ['staff'] as const,
  list: () => [...staffKeys.all, 'list'] as const,
  me: () => [...staffKeys.all, 'me'] as const,
  invite: (token: string) => [...staffKeys.all, 'invite', token] as const,
};

/** The signed-in Staff member's role, to show Admin-only controls. */
export function useCurrentStaffMember() {
  return useQuery<CurrentStaffMember>({
    queryKey: staffKeys.me(),
    queryFn: () => call(() => staff.me.$get()),
  });
}

/** Everyone, Invited people included. Admins only: a Member gets a 403. */
export function useStaffMembers() {
  return useQuery<StaffMemberView[]>({
    queryKey: staffKeys.list(),
    queryFn: () => call(() => staff.$get()),
  });
}

function useStaffMutation<TInput, TResult>(send: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: send,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: staffKeys.list() }),
  });
}

export function useInviteStaffMember() {
  return useStaffMutation(
    (body: InviteStaffBody): Promise<StaffMemberView> =>
      call(() => staff.invites.$post({ json: body })),
  );
}

export function useResendInvite() {
  return useStaffMutation(
    (staffId: string): Promise<StaffMemberView> =>
      call(() => staff[':staffId'].invite.resend.$post({ param: { staffId } })),
  );
}

export function useCancelInvite() {
  return useStaffMutation(async (staffId: string): Promise<void> => {
    await call(async () => {
      const res = await staff[':staffId'].invite.$delete({ param: { staffId } });
      // 204: no body to read.
      return {
        ok: res.ok,
        status: res.status,
        json: () => (res.ok ? Promise.resolve() : res.json()),
      };
    });
  });
}

/** An Admin changes someone else's role. */
export function useChangeRole() {
  return useStaffMutation(
    ({ staffId, role }: { staffId: string } & ChangeRoleBody): Promise<StaffMemberView> =>
      call(() => staff[':staffId'].role.$patch({ param: { staffId }, json: { role } })),
  );
}

/** Deactivates someone who has left: their sessions end at once. */
export function useDeactivateStaffMember() {
  return useStaffMutation(
    (staffId: string): Promise<StaffMemberView> =>
      call(() => staff[':staffId'].deactivate.$post({ param: { staffId } })),
  );
}

/** Reactivates a Deactivated Staff member, with their memberships as they were. */
export function useReactivateStaffMember() {
  return useStaffMutation(
    (staffId: string): Promise<StaffMemberView> =>
      call(() => staff[':staffId'].reactivate.$post({ param: { staffId } })),
  );
}

/**
 * Changes your own display name. The name lives in Better Auth's session too, so the
 * caller refetches the session; the Staff members list is invalidated here.
 */
export function useChangeName(staffId: string) {
  return useStaffMutation(
    (body: ChangeNameBody): Promise<NameChanged> =>
      call(() => staff[':staffId'].name.$patch({ param: { staffId }, json: body })),
  );
}

/** Sends a link to the new address. Nothing changes until it's opened. */
export function useRequestEmailChange(staffId: string) {
  return useMutation({
    mutationFn: async (body: ChangeEmailBody): Promise<void> => {
      await call(async () => {
        const res = await staff[':staffId'].email.$post({ param: { staffId }, json: body });
        // 202: no body to read.
        return {
          ok: res.ok,
          status: res.status,
          json: () => (res.ok ? Promise.resolve() : res.json()),
        };
      });
    },
  });
}

/** Opens an email-change link: the change takes effect. Works signed out. */
export function useConfirmEmailChange() {
  return useMutation({
    mutationFn: (token: string): Promise<EmailChangeConfirmed> =>
      call(() => api.api['email-change'].confirm.$post({ json: { token } })),
  });
}

/** The invite a token belongs to: the set-password page's name and email. */
export function useInvite(token: string) {
  return useQuery<InviteView>({
    queryKey: staffKeys.invite(token),
    queryFn: () => call(() => invites.lookup.$post({ json: { token } })),
    retry: false,
  });
}

/** Sets the password and signs in: the response carries the session cookie. */
export function useAcceptInvite() {
  return useMutation({
    mutationFn: (body: AcceptInviteBody) => call(() => invites.accept.$post({ json: body })),
  });
}
