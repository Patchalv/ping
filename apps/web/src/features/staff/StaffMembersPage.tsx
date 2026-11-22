import type { StaffMemberView } from '@ping/shared';
import { Link } from '@tanstack/react-router';
import { ChevronLeftIcon, UserPlusIcon } from 'lucide-react';
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
import { FormError } from '../../components/FormError';
import { StaffAvatar } from '../../components/StaffAvatar';
import { useCancelInvite, useResendInvite, useStaffMembers } from './api';
import { InviteDialog } from './InviteDialog';

/**
 * The Admins' Staff members screen (screens.md › Admin screens): everyone with their role
 * and state. Invited people show Resend and Cancel. Changing a role, Deactivation and
 * Reactivate arrive with #35.
 */
export function StaffMembersPage() {
  const staff = useStaffMembers();
  const [inviting, setInviting] = useState(false);

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
              <StaffRow key={person.id} person={person} />
            ))}
          </ul>
        )}
      </section>
      {inviting ? <InviteDialog onClose={() => setInviting(false)} /> : null}
    </>
  );
}

function StaffRow({ person }: { person: StaffMemberView }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <StaffAvatar staff={person} />
      <div className="grid min-w-0 flex-1 basis-48">
        <span className="truncate font-semibold">{person.name}</span>
        <span className="truncate text-small text-muted-foreground">{person.email}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="tag">{person.role === 'admin' ? 'Admin' : 'Member'}</Badge>
        <StateBadge person={person} />
      </div>
      {person.invite ? <InviteActions person={person} /> : null}
    </li>
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
