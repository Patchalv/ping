import type { ChannelView, MemberCandidate } from '@ping/shared';
import { useId, useState } from 'react';
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
import { Input } from '#/components/ui/input';
import { Label } from '#/components/ui/label';
import { FormError } from '../../components/FormError';
import { StaffAvatar } from '../../components/StaffAvatar';
import { useAddChannelMember, useMemberCandidates } from './api';

/**
 * The add-members picker: active Staff members who aren't in the Channel (no Invited or
 * Deactivated people), filtered by name. Each Add joins them as a plain member, and they
 * drop off the list.
 */
export function AddMembersDialog({ channel, onClose }: { channel: ChannelView; onClose(): void }) {
  const candidates = useMemberCandidates(channel.id);
  const add = useAddChannelMember(channel.id);
  const [filter, setFilter] = useState('');
  const filterId = useId();
  const needle = filter.trim().toLocaleLowerCase();
  const shown =
    candidates.data?.filter((person) => person.name.toLocaleLowerCase().includes(needle)) ?? [];

  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add members to {channel.name}</DialogTitle>
          <DialogDescription>
            {channel.visibility === 'private'
              ? 'They can read this Private channel as soon as you add them.'
              : 'It shows in their sidebar. They can leave whenever they like.'}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label htmlFor={filterId}>Find a Staff member</Label>
          <Input
            id={filterId}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Type a name"
            autoComplete="off"
          />
        </div>
        {add.isError ? <FormError>{add.error.message}</FormError> : null}
        {candidates.isPending ? (
          <p className="py-6 text-center text-muted-foreground">Loading…</p>
        ) : candidates.isError ? (
          <p className="py-6 text-center text-destructive" role="alert">
            {candidates.error.message}
          </p>
        ) : shown.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">
            {candidates.data.length === 0
              ? 'Everyone is already in this Channel.'
              : 'Nobody by that name to add.'}
          </p>
        ) : (
          <ul className="max-h-72 divide-y overflow-y-auto rounded-lg border">
            {shown.map((person) => (
              <CandidateRow
                key={person.staffId}
                person={person}
                adding={add.isPending && add.variables === person.staffId}
                disabled={add.isPending}
                onAdd={() => add.mutate(person.staffId)}
              />
            ))}
          </ul>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CandidateRow({
  person,
  adding,
  disabled,
  onAdd,
}: {
  person: MemberCandidate;
  adding: boolean;
  disabled: boolean;
  onAdd(): void;
}) {
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <StaffAvatar staff={{ id: person.staffId, name: person.name }} size="sm" />
      <span className="min-w-0 flex-1 truncate font-semibold">{person.name}</span>
      <Button
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={onAdd}
        aria-label={`Add ${person.name}`}
      >
        {adding ? 'Adding…' : 'Add'}
      </Button>
    </li>
  );
}
