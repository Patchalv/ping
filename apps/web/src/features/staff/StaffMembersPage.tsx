import type { StaffMemberView } from '@ping/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronDownIcon, ChevronLeftIcon, UserPlusIcon } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { cn } from '#/lib/utils';
import { FormError } from '../../components/FormError';
import { StaffAvatar } from '../../components/StaffAvatar';
import {
  useCancelInvite,
  useChangeRole,
  useCurrentStaffMember,
  useDeactivateStaffMember,
  useDemoteMyself,
  useReactivateStaffMember,
  useResendInvite,
  useStaffMembers,
} from './api';
import { InviteDialog } from './InviteDialog';

/**
 * The Admins' Staff members screen (screens.md › Admin screens): everyone with their role
 * and state. Invited people show Resend and Cancel; active people can have their role
 * changed or be Deactivated; Deactivated people show greyed, with Reactivate.
 */
export function StaffMembersPage() {
  const staff = useStaffMembers();
  const me = useCurrentStaffMember();
  const [inviting, setInviting] = useState(false);
  // Only hides the control: the server refuses the last active Admin demoting themself.
  const activeAdmins =
    staff.data?.filter((person) => person.role === 'admin' && person.state === 'active').length ??
    0;

  return (
    <>
      <section
        className="sticky top-0 z-10 border-b bg-background px-4 py-2.5 md:px-5 md:py-3"
        aria-label="Staff members"
      >
        <div className="flex min-w-0 items-center gap-2.5">
          {/* Phone only: the sidebar is the home screen, so this page needs a way back. */}
          <Link
            className="-ml-1 inline-flex shrink-0 items-center text-sm font-semibold text-primary md:hidden"
            to="/"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-4" />
            Channels
          </Link>
          <h1 className="min-w-0 truncate text-lg font-bold">Staff members</h1>
          {staff.isSuccess ? (
            <Button className="ml-auto" onClick={() => setInviting(true)}>
              <UserPlusIcon aria-hidden="true" />
              Invite
            </Button>
          ) : null}
        </div>
      </section>
      <section className="px-4 pt-3 pb-20 md:px-5">
        {staff.isPending ? (
          <p className="py-10 text-center text-muted-foreground">Loading…</p>
        ) : staff.isError ? (
          <p className="py-10 text-center text-destructive" role="alert">
            {staff.error.message}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border bg-background">
            {staff.data.map((person) => (
              <StaffRow
                key={person.id}
                person={person}
                isSelf={person.id === me.data?.id}
                canDemoteSelf={activeAdmins > 1}
              />
            ))}
          </ul>
        )}
      </section>
      {inviting ? <InviteDialog onClose={() => setInviting(false)} /> : null}
    </>
  );
}

function StaffRow({
  person,
  isSelf,
  canDemoteSelf,
}: {
  person: StaffMemberView;
  isSelf: boolean;
  canDemoteSelf: boolean;
}) {
  const deactivated = person.state === 'deactivated';
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <StaffAvatar staff={person} tone={deactivated ? 'deactivated' : 'active'} />
      <div className="grid min-w-0 flex-1 basis-48">
        <span
          className={cn('truncate font-semibold', deactivated ? 'text-muted-foreground' : null)}
        >
          {person.name}
          {isSelf ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
        </span>
        <span className="truncate text-small text-muted-foreground">{person.email}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="tag">{person.role === 'admin' ? 'Admin' : 'Member'}</Badge>
        <StateBadge person={person} />
      </div>
      {/* On your own row, only stepping down; another Admin Deactivates you. */}
      {isSelf ? (
        canDemoteSelf ? (
          <DemoteMyselfAction person={person} />
        ) : null
      ) : person.invite ? (
        <InviteActions person={person} />
      ) : deactivated ? (
        <ReactivateAction person={person} />
      ) : (
        <ManageMenu person={person} />
      )}
    </li>
  );
}

/** Change the role of, or Deactivate, an active Staff member. */
function ManageMenu({ person }: { person: StaffMemberView }) {
  const changeRole = useChangeRole();
  const [deactivating, setDeactivating] = useState(false);
  const nextRole = person.role === 'admin' ? 'member' : 'admin';

  return (
    <div className="flex flex-wrap items-center gap-2 max-md:w-full">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" />}
          disabled={changeRole.isPending}
        >
          {changeRole.isPending ? 'Saving…' : 'Manage'}
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate">{person.name}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => changeRole.mutate({ staffId: person.id, role: nextRole })}
            >
              {nextRole === 'admin' ? 'Make Admin' : 'Make Member'}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={() => setDeactivating(true)}>
            Deactivate…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {changeRole.isError ? (
        <FormError className="w-full">{changeRole.error.message}</FormError>
      ) : null}
      {deactivating ? (
        <DeactivateDialog person={person} onClose={() => setDeactivating(false)} />
      ) : null}
    </div>
  );
}

/** An Admin makes themself a Member. They lose this screen, so it asks first. */
function DemoteMyselfAction({ person }: { person: StaffMemberView }) {
  const demote = useDemoteMyself();
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Make me a Member…
      </Button>
      {confirming ? (
        <Dialog
          defaultOpen
          onOpenChange={(open) => {
            if (!open) setConfirming(false);
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Make yourself a Member?</DialogTitle>
              <DialogDescription>
                You can no longer invite, Deactivate or set the role of Staff members. Only another
                Admin can make you an Admin again.
              </DialogDescription>
            </DialogHeader>
            {demote.isError ? <FormError>{demote.error.message}</FormError> : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button
                variant="destructive"
                disabled={demote.isPending}
                onClick={() =>
                  demote.mutate(person.id, { onSuccess: () => void navigate({ to: '/' }) })
                }
              >
                {demote.isPending ? 'Saving…' : 'Make me a Member'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

/** Deactivation can be undone, but it ends their sessions at once, so it asks first. */
function DeactivateDialog({ person, onClose }: { person: StaffMemberView; onClose(): void }) {
  const deactivate = useDeactivateStaffMember();
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate {person.name}?</DialogTitle>
          <DialogDescription>
            They’re signed out everywhere and can’t sign in again. Everything they wrote stays, and
            their Channel memberships are kept for if you reactivate them. Where they were the only
            Channel admin, the member who joined earliest takes over. A Channel left with nobody
            active is archived.
          </DialogDescription>
        </DialogHeader>
        {deactivate.isError ? <FormError>{deactivate.error.message}</FormError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={deactivate.isPending}
            onClick={() => deactivate.mutate(person.id, { onSuccess: onClose })}
          >
            {deactivate.isPending ? 'Deactivating…' : 'Deactivate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reactivate a Deactivated Staff member: they can sign in again. */
function ReactivateAction({ person }: { person: StaffMemberView }) {
  const reactivate = useReactivateStaffMember();
  return (
    <div className="flex flex-wrap items-center gap-2 max-md:w-full">
      <Button
        variant="outline"
        size="sm"
        disabled={reactivate.isPending}
        onClick={() => reactivate.mutate(person.id)}
      >
        {reactivate.isPending ? 'Reactivating…' : 'Reactivate'}
      </Button>
      {reactivate.isError ? (
        <FormError className="w-full">{reactivate.error.message}</FormError>
      ) : null}
    </div>
  );
}

function StateBadge({ person }: { person: StaffMemberView }) {
  if (person.state === 'deactivated') return <Badge variant="tag">Deactivated</Badge>;
  if (!person.invite) return null;
  return <Badge variant="tag">Invited</Badge>;
}

/** The Resend button says why it's needed (screens.md › Admin screens). */
function resendLabel(invite: StaffMemberView['invite']): string {
  if (invite?.emailFailed) return 'Email not sent, Resend';
  if (invite?.expired) return 'Expired, Resend';
  return 'Resend';
}

/** Resend and Cancel for an Invited person, and any failure beside them. */
function InviteActions({ person }: { person: StaffMemberView }) {
  const resend = useResendInvite();
  const [cancelling, setCancelling] = useState(false);
  const failure = resend.error?.message;

  return (
    <div className="flex flex-wrap items-center gap-2 max-md:w-full">
      <Button
        variant="outline"
        size="sm"
        disabled={resend.isPending}
        onClick={() => resend.mutate(person.id)}
      >
        {resend.isPending ? 'Resending…' : resendLabel(person.invite)}
      </Button>
      <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>
        Cancel invite
      </Button>
      {failure ? <FormError className="w-full">{failure}</FormError> : null}
      {cancelling ? (
        <CancelInviteDialog person={person} onClose={() => setCancelling(false)} />
      ) : null}
    </div>
  );
}

/** Cancel hard-deletes the Invited person, so it asks first. */
function CancelInviteDialog({ person, onClose }: { person: StaffMemberView; onClose(): void }) {
  const cancel = useCancelInvite();
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel {person.name}’s invite?</DialogTitle>
          <DialogDescription>
            Their invite link stops working and they’re removed from Ping. You can invite them again
            later.
          </DialogDescription>
        </DialogHeader>
        {cancel.isError ? <FormError>{cancel.error.message}</FormError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep invite</DialogClose>
          <Button
            variant="destructive"
            disabled={cancel.isPending}
            onClick={() => cancel.mutate(person.id, { onSuccess: onClose })}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
