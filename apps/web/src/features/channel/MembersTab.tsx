import type { ChannelMembers, ChannelMemberView, ChannelView } from '@ping/shared';
import { ChevronDownIcon, ShieldIcon, UserPlusIcon } from 'lucide-react';
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
import { AddMembersDialog } from './AddMembersDialog';
import { useChannelMembers, useRemoveChannelMember, useSetChannelAdmin } from './api';

/**
 * The Members tab (screens.md › Channel view): members with Channel admins marked, and
 * Deactivated members greyed with their label. Controls show only when the server says
 * the Staff member may use them; the server still decides every change.
 */
export function MembersTab({ channel }: { channel: ChannelView }) {
  const members = useChannelMembers(channel.id);
  const [adding, setAdding] = useState(false);

  return (
    <section className="px-4 pt-3 pb-20 md:px-5" aria-label="Members">
      {members.isPending ? (
        <p className="py-10 text-center text-muted-foreground">Loading…</p>
      ) : members.isError ? (
        <p className="py-10 text-center text-destructive" role="alert">
          {members.error.message}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {members.data.can.add ? (
              <Button onClick={() => setAdding(true)}>
                <UserPlusIcon aria-hidden="true" />
                Add members
              </Button>
            ) : null}
            {members.data.can.setChannelAdmin && !channel.isChannelAdmin ? (
              <MakeMeChannelAdmin channel={channel} actorStaffId={members.data.actorStaffId} />
            ) : null}
          </div>
          <ul className="divide-y rounded-lg border bg-background">
            {members.data.members.map((member) => (
              <MemberRow
                key={member.staffId}
                channel={channel}
                access={members.data}
                member={member}
              />
            ))}
          </ul>
        </>
      )}
      {adding ? <AddMembersDialog channel={channel} onClose={() => setAdding(false)} /> : null}
    </section>
  );
}

function MemberRow({
  channel,
  access,
  member,
}: {
  channel: ChannelView;
  access: ChannelMembers;
  member: ChannelMemberView;
}) {
  const isSelf = member.staffId === access.actorStaffId;
  // You leave through Leave in the Channel bar, not by removing yourself. Only active Staff
  // members can be made Channel admin.
  const canRemove = access.can.remove && !isSelf;
  const canSetChannelAdmin =
    access.can.setChannelAdmin && (member.isChannelAdmin || !member.isDeactivated);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
      <StaffAvatar
        staff={{ id: member.staffId, name: member.name }}
        tone={member.isDeactivated ? 'deactivated' : 'active'}
      />
      <span
        className={cn(
          'min-w-0 flex-1 basis-40 truncate font-semibold',
          member.isDeactivated ? 'text-muted-foreground' : null,
        )}
      >
        {member.name}
        {isSelf ? <span className="font-normal text-muted-foreground"> (you)</span> : null}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {member.isChannelAdmin ? (
          <Badge variant="tag">
            <ShieldIcon aria-hidden="true" />
            Channel admin
          </Badge>
        ) : null}
        {member.isDeactivated ? <Badge variant="tag">Deactivated</Badge> : null}
      </div>
      {canRemove || canSetChannelAdmin ? (
        <ManageMemberMenu
          channel={channel}
          member={member}
          canRemove={canRemove}
          canSetChannelAdmin={canSetChannelAdmin}
        />
      ) : null}
    </li>
  );
}

/** Appoint or remove a Channel admin, or remove the member. */
function ManageMemberMenu({
  channel,
  member,
  canRemove,
  canSetChannelAdmin,
}: {
  channel: ChannelView;
  member: ChannelMemberView;
  canRemove: boolean;
  canSetChannelAdmin: boolean;
}) {
  const setChannelAdmin = useSetChannelAdmin(channel.id);
  const [removing, setRemoving] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 max-md:w-full">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" size="sm" />}
          disabled={setChannelAdmin.isPending}
        >
          {setChannelAdmin.isPending ? 'Saving…' : 'Manage'}
          <ChevronDownIcon aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel className="truncate">{member.name}</DropdownMenuLabel>
            {canSetChannelAdmin ? (
              <DropdownMenuItem
                onClick={() =>
                  setChannelAdmin.mutate({
                    staffId: member.staffId,
                    isChannelAdmin: !member.isChannelAdmin,
                  })
                }
              >
                {member.isChannelAdmin ? 'Remove Channel admin role' : 'Make Channel admin'}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
          {canRemove ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setRemoving(true)}>
                Remove from Channel…
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      {setChannelAdmin.isError ? (
        <FormError className="w-full">{setChannelAdmin.error.message}</FormError>
      ) : null}
      {removing ? (
        <RemoveMemberDialog channel={channel} member={member} onClose={() => setRemoving(false)} />
      ) : null}
    </div>
  );
}

function RemoveMemberDialog({
  channel,
  member,
  onClose,
}: {
  channel: ChannelView;
  member: ChannelMemberView;
  onClose(): void;
}) {
  const remove = useRemoveChannelMember(channel.id);
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Remove {member.name} from {channel.name}?
          </DialogTitle>
          <DialogDescription>
            {channel.visibility === 'private'
              ? 'It’s Private, so they can’t read it any more. A Channel admin has to add them back.'
              : 'It leaves their sidebar. It’s Public, so they can still read it and join again.'}
          </DialogDescription>
        </DialogHeader>
        {remove.isError ? <FormError>{remove.error.message}</FormError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate(member.staffId, { onSuccess: onClose })}
          >
            {remove.isPending ? 'Removing…' : 'Remove'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A company Admin's way in to a Public channel's settings and members: they make
 * themself Channel admin, which shows in the member list.
 */
function MakeMeChannelAdmin({
  channel,
  actorStaffId,
}: {
  channel: ChannelView;
  actorStaffId: string;
}) {
  const setChannelAdmin = useSetChannelAdmin(channel.id);
  return (
    <>
      <Button
        variant="outline"
        disabled={setChannelAdmin.isPending}
        onClick={() => setChannelAdmin.mutate({ staffId: actorStaffId, isChannelAdmin: true })}
      >
        <ShieldIcon aria-hidden="true" />
        {setChannelAdmin.isPending ? 'Saving…' : 'Make me Channel admin'}
      </Button>
      {setChannelAdmin.isError ? (
        <FormError className="basis-full">{setChannelAdmin.error.message}</FormError>
      ) : null}
    </>
  );
}
