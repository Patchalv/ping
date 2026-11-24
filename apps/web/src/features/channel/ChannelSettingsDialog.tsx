import {
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  type ChannelView,
  type ResolvePolicy,
  type UpdateChannelBody,
  updateChannelBody,
} from '@ping/shared';
import { revalidateLogic } from '@tanstack/react-form';
import { LockIcon } from 'lucide-react';
import { useState } from 'react';
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
import { useUpdateChannel } from './api';

type Props = { channel: ChannelView; onClose(): void };

/**
 * Channel settings, for its Channel admins (product.md › Channels): name, description and
 * "Who can resolve threads?", and turning a Public channel Private. A Private channel
 * offers no way back.
 */
export function ChannelSettingsDialog({ channel, onClose }: Props) {
  const update = useUpdateChannel(channel.id);
  // A failure no field explains: the network, or a refusal.
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmingPrivate, setConfirmingPrivate] = useState(false);

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

  if (confirmingPrivate) {
    return (
      <MakePrivateDialog
        channel={channel}
        onClose={onClose}
        onBack={() => setConfirmingPrivate(false)}
      />
    );
  }

  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
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
                  <ResolveChoice
                    value="any_member"
                    title="Any Channel member"
                    hint="Anyone in the Channel can resolve and reopen its Threads."
                  />
                  <ResolveChoice
                    value="author_and_channel_admins"
                    title="Thread author and Channel admins"
                    hint="Only the person who started a Thread, or a Channel admin."
                  />
                </field.RadioGroupField>
              )}
            </form.AppField>
            <section className="grid gap-2" aria-labelledby="channel-visibility">
              <h3 id="channel-visibility" className="text-sm font-semibold">
                Visibility
              </h3>
              {channel.visibility === 'public' ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                    Public: any Staff member can find, read and join it.
                  </p>
                  <Button variant="outline" onClick={() => setConfirmingPrivate(true)}>
                    <LockIcon aria-hidden="true" />
                    Make Private…
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Private: only its members can find and read it. A Private channel can’t be made
                  Public.
                </p>
              )}
            </section>
            {formError ? <FormError>{formError}</FormError> : null}
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <form.SubmitButton pending="Saving…">Save</form.SubmitButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogContent>
    </Dialog>
  );
}

/** One "Who can resolve threads?" option as a card: the radio, its name and what it means. */
function ResolveChoice({
  value,
  title,
  hint,
}: {
  value: ResolvePolicy;
  title: string;
  hint: string;
}) {
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
