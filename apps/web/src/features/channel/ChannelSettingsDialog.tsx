import {
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  type ChannelView,
  type ResolvePolicy,
  type UpdateChannelBody,
  updateChannelBody,
} from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { ArchiveIcon, ArchiveRestoreIcon, LockIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { showServerIssues, useAppForm } from '#/components/form';
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
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '#/components/ui/field';
import { RadioGroupItem } from '#/components/ui/radio-group';
import { FormError } from '../../components/FormError';
import { ApiError } from '../../lib/api-client';
import { useArchiveChannel, useLeaveChannel, useUnarchiveChannel, useUpdateChannel } from './api';

type Props = { channel: ChannelView; onClose(): void };

/** Which dialog shows: the settings, or one of the confirmations that replace them. */
type Step = 'settings' | 'make-private' | 'archive' | 'leave';

const RESOLVE_CHOICES: Record<ResolvePolicy, { title: string; hint: string }> = {
  any_member: {
    title: 'Any Channel member',
    hint: 'Anyone in the Channel can resolve and reopen its Threads.',
  },
  author_and_channel_admins: {
    title: 'Thread author and Channel admins',
    hint: 'Only the person who started a Thread, or a Channel admin.',
  },
};

/**
 * Channel settings (product.md › Channels), for everyone who can read the Channel: name,
 * description, "Who can resolve threads?" and visibility. Its Channel admins change them
 * and can turn a Public channel Private, which offers no way back; everyone else, and
 * everyone in an Archived channel, only reads them. Below sit Archive or Unarchive, for
 * whoever may, and Leave, for members.
 */
export function ChannelSettingsDialog({ channel, onClose }: Props) {
  const [step, setStep] = useState<Step>('settings');
  const back = () => setStep('settings');
  // Here, not in ChannelActions: once it's unarchived the view below would turn editable
  // and remount them, losing the close on success.
  const unarchive = useUnarchiveChannel(channel.id);
  // Settings don't change in an Archived channel, nor while it's being unarchived.
  const editable =
    channel.isChannelAdmin && !channel.isArchived && !unarchive.isPending && !unarchive.isSuccess;

  // Kept while a confirmation shows, so Back returns to the same edits.
  const update = useUpdateChannel(channel.id);
  // A failure no field explains: the network, or a refusal.
  const [formError, setFormError] = useState<string | null>(null);
  const defaultValues: UpdateChannelBody = {
    name: channel.name,
    description: channel.description,
    resolvePolicy: channel.resolvePolicy,
  };
  const form = useAppForm({
    formId: 'channel-settings',
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: updateChannelBody },
    onSubmit: async ({ value, formApi }) => {
      setFormError(null);
      try {
        await update.mutateAsync(updateChannelBody.parse(value));
        onClose();
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        if (!showServerIssues(formApi, error.issues)) setFormError(error.message);
      }
    },
  });

  if (step === 'make-private') {
    return <MakePrivateDialog channel={channel} onClose={onClose} onBack={back} />;
  }
  if (step === 'archive') {
    return <ArchiveDialog channel={channel} onDone={onClose} onBack={back} />;
  }
  if (step === 'leave') {
    return <LeaveDialog channel={channel} onDone={onClose} onBack={back} />;
  }

  const actions = (
    <ChannelActions channel={channel} unarchive={unarchive} onDone={onClose} onConfirm={setStep} />
  );
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        {editable ? (
          <form.AppForm>
            <form.Form className="grid gap-5">
              <DialogHeader>
                <DialogTitle>Channel settings</DialogTitle>
              </DialogHeader>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField label="Name" maxLength={CHANNEL_NAME_MAX} autoComplete="off" />
                )}
              </form.AppField>
              <form.AppField name="description">
                {(field) => (
                  <field.TextareaField
                    label="Description"
                    maxLength={CHANNEL_DESCRIPTION_MAX}
                    rows={3}
                  />
                )}
              </form.AppField>
              <form.AppField name="resolvePolicy">
                {(field) => (
                  <field.RadioGroupField legend="Who can resolve threads?">
                    <ResolveChoice value="any_member" />
                    <ResolveChoice value="author_and_channel_admins" />
                  </field.RadioGroupField>
                )}
              </form.AppField>
              <VisibilitySection channel={channel}>
                {channel.visibility === 'public' ? (
                  <Button variant="outline" onClick={() => setStep('make-private')}>
                    <LockIcon aria-hidden="true" />
                    Make Private…
                  </Button>
                ) : null}
              </VisibilitySection>
              {formError ? <FormError>{formError}</FormError> : null}
              {actions}
              <DialogFooter>
                <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
                <form.SubmitButton pending="Saving…">Save</form.SubmitButton>
              </DialogFooter>
            </form.Form>
          </form.AppForm>
        ) : (
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>Channel settings</DialogTitle>
              {channel.isArchived ? (
                <DialogDescription>
                  It’s Archived, so its settings can’t change until it’s unarchived.
                </DialogDescription>
              ) : (
                <DialogDescription>Only its Channel admins can change these.</DialogDescription>
              )}
            </DialogHeader>
            <ReadOnlySettings channel={channel} />
            {actions}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Close</DialogClose>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The settings as text, for anyone who can't change them. */
function ReadOnlySettings({ channel }: { channel: ChannelView }) {
  const resolve = RESOLVE_CHOICES[channel.resolvePolicy];
  return (
    <dl className="grid gap-4 text-sm">
      <div className="grid gap-1">
        <dt className="font-semibold">Name</dt>
        <dd className="[overflow-wrap:anywhere]">{channel.name}</dd>
      </div>
      <div className="grid gap-1">
        <dt className="font-semibold">Description</dt>
        <dd className="whitespace-pre-line [overflow-wrap:anywhere]">
          {channel.description || <span className="text-muted-foreground">No description</span>}
        </dd>
      </div>
      <div className="grid gap-1">
        <dt className="font-semibold">Who can resolve threads?</dt>
        <dd>
          {resolve.title}
          <span className="block text-muted-foreground">{resolve.hint}</span>
        </dd>
      </div>
      <div className="grid gap-1">
        <dt className="font-semibold">Visibility</dt>
        <dd className="text-muted-foreground">{visibilityNote(channel)}</dd>
      </div>
    </dl>
  );
}

function visibilityNote(channel: ChannelView): string {
  return channel.visibility === 'public'
    ? 'Public: any Staff member can find, read and join it.'
    : 'Private: only its members can find and read it. A Private channel can’t be made Public.';
}

/** The Visibility section of the editable settings, with room for Make Private…. */
function VisibilitySection({ channel, children }: { channel: ChannelView; children: ReactNode }) {
  return (
    <section className="grid gap-2" aria-labelledby="channel-visibility">
      <h3 id="channel-visibility" className="text-sm font-semibold">
        Visibility
      </h3>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">{visibilityNote(channel)}</p>
        {children}
      </div>
    </section>
  );
}

/** One "Who can resolve threads?" option as a card: the radio, its name and what it means. */
function ResolveChoice({ value }: { value: ResolvePolicy }) {
  const { title, hint } = RESOLVE_CHOICES[value];
  return (
    <FieldLabel>
      <Field orientation="horizontal">
        <RadioGroupItem value={value} />
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          <FieldDescription>{hint}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}

/**
 * Archive or Unarchive, for whoever the server allows, and Leave, for members. Archive and
 * Leave ask first; Unarchive happens at once, as it only reopens the Channel and Pings
 * nobody.
 */
function ChannelActions({
  channel,
  unarchive,
  onDone,
  onConfirm,
}: {
  channel: ChannelView;
  unarchive: ReturnType<typeof useUnarchiveChannel>;
  onDone(): void;
  onConfirm(step: 'archive' | 'leave'): void;
}) {
  const canArchive = !channel.isArchived && channel.can.archive;
  const canUnarchive = channel.isArchived && channel.can.unarchive;
  if (!canArchive && !canUnarchive && !channel.isMember) return null;
  return (
    <section className="grid gap-2 border-t pt-4" aria-label="Channel actions">
      <div className="flex flex-wrap gap-2">
        {canArchive ? (
          <Button variant="outline" onClick={() => onConfirm('archive')}>
            <ArchiveIcon aria-hidden="true" />
            Archive…
          </Button>
        ) : null}
        {canUnarchive ? (
          <Button
            variant="outline"
            disabled={unarchive.isPending}
            onClick={() => unarchive.mutate(undefined, { onSuccess: onDone })}
          >
            <ArchiveRestoreIcon aria-hidden="true" />
            {unarchive.isPending ? 'Unarchiving…' : 'Unarchive'}
          </Button>
        ) : null}
        {channel.isMember ? (
          <Button variant="outline" onClick={() => onConfirm('leave')}>
            Leave…
          </Button>
        ) : null}
      </div>
      {unarchive.isError ? <FormError>{unarchive.error.message}</FormError> : null}
    </section>
  );
}

/** Turning a Channel Private can't be undone, and removes everyone else at once: ask first. */
function MakePrivateDialog({
  channel,
  onClose,
  onBack,
}: {
  channel: ChannelView;
  onClose(): void;
  onBack(): void;
}) {
  const update = useUpdateChannel(channel.id);
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Make {channel.name} Private?</DialogTitle>
          <DialogDescription>
            Only its {channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'} will
            be able to find and read it. Everyone else loses access at once, with their Pings, Saved
            Threads and mutes for it. Members get a Ping saying it’s now Private. This can’t be
            undone.
          </DialogDescription>
        </DialogHeader>
        {update.isError ? <FormError>{update.error.message}</FormError> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button
            variant="destructive"
            disabled={update.isPending}
            onClick={() => update.mutate({ visibility: 'private' }, { onSuccess: onClose })}
          >
            {update.isPending ? 'Making Private…' : 'Make Private'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ConfirmProps = { channel: ChannelView; onDone(): void; onBack(): void };

/** Archive, after asking: it stops new activity, and starts a System thread that Pings members. */
function ArchiveDialog({ channel, onDone, onBack }: ConfirmProps) {
  const archive = useArchiveChannel(channel.id);
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onBack();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive {channel.name}?</DialogTitle>
          <DialogDescription>
            Everyone who can read it still can. Nobody can start Threads, respond, react, edit,
            resolve, join or change its members or settings until it’s unarchived. Its members get a
            Ping for the System thread that announces it.
          </DialogDescription>
        </DialogHeader>
        {archive.isError ? <FormError>{archive.error.message}</FormError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={archive.isPending}
            onClick={() => archive.mutate(undefined, { onSuccess: onDone })}
          >
            {archive.isPending ? 'Archiving…' : 'Archive'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Leave, after asking: the server refuses the last active Channel admin, with a reason. */
function LeaveDialog({ channel, onDone, onBack }: ConfirmProps) {
  const navigate = useNavigate();
  const isPrivate = channel.visibility === 'private';
  const leave = useLeaveChannel({
    onLeft: () => {
      onDone();
      // A Private channel is gone once you leave, so move off it.
      if (isPrivate) void navigate({ to: '/browse' });
    },
  });
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onBack();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave {channel.name}?</DialogTitle>
          <DialogDescription>
            {isPrivate
              ? 'It’s Private, so you can’t read it any more once you leave. A Channel admin has to add you back.'
              : 'It leaves your sidebar. It’s Public, so you can still read it and join again from Browse channels.'}
          </DialogDescription>
        </DialogHeader>
        {leave.isError ? <FormError>{leave.error.message}</FormError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={leave.isPending}
            onClick={() => leave.mutate(channel)}
          >
            {leave.isPending ? 'Leaving…' : 'Leave'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
