import {
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  type ChannelView,
  type CreateChannelBody,
  createChannelBody,
} from '@ping/shared';
import { type FormEvent, useState } from 'react';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group';
import { Textarea } from '#/components/ui/textarea';
import { FormError } from '../../components/FormError';
import { ApiError, type FieldIssue } from '../../lib/api-client';
import { useCreateChannel } from './api';

type Props = { onClose(): void; onCreated(channel: ChannelView): void };

/** Create channel: name, description and visibility (screens.md › Other flows). */
export function CreateChannelDialog({ onClose, onCreated }: Props) {
  const create = useCreateChannel();
  // Issues found before sending; the server's own come from the mutation's error.
  const [localIssues, setLocalIssues] = useState<FieldIssue[] | null>(null);

  const serverError = create.error instanceof ApiError ? create.error : null;
  const issues = localIssues ?? serverError?.issues ?? [];
  const issueFor = (path: string) => issues.find((issue) => issue.path === path)?.message;
  // A failure no field explains: the network, or a refusal.
  const formError =
    localIssues === null && serverError?.issues.length === 0 ? serverError.message : null;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: CreateChannelBody = {
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
      visibility: form.get('visibility') === 'private' ? 'private' : 'public',
    };
    // The server checks again; this saves a round trip for the obvious mistakes.
    const parsed = createChannelBody.safeParse(body);
    if (!parsed.success) {
      setLocalIssues(
        parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
      return;
    }
    setLocalIssues(null);
    create.mutate(parsed.data, { onSuccess: onCreated });
  }

  const nameIssue = issueFor('name');
  const descriptionIssue = issueFor('description');
  const visibilityIssue = issueFor('visibility');

  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <form className="grid gap-5" onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>Create a Channel</DialogTitle>
          </DialogHeader>
          <Field data-invalid={nameIssue ? true : undefined}>
            <FieldLabel htmlFor="create-channel-name">Name</FieldLabel>
            <Input
              id="create-channel-name"
              name="name"
              maxLength={CHANNEL_NAME_MAX}
              autoComplete="off"
              aria-invalid={nameIssue ? true : undefined}
              aria-describedby={nameIssue ? 'create-channel-name-issue' : undefined}
            />
            {nameIssue ? <FieldError id="create-channel-name-issue">{nameIssue}</FieldError> : null}
          </Field>
          <Field data-invalid={descriptionIssue ? true : undefined}>
            <FieldLabel htmlFor="create-channel-description">Description</FieldLabel>
            <Textarea
              id="create-channel-description"
              name="description"
              maxLength={CHANNEL_DESCRIPTION_MAX}
              rows={3}
              aria-invalid={descriptionIssue ? true : undefined}
              aria-describedby={descriptionIssue ? 'create-channel-description-issue' : undefined}
            />
            {descriptionIssue ? (
              <FieldError id="create-channel-description-issue">{descriptionIssue}</FieldError>
            ) : null}
          </Field>
          <FieldSet>
            <FieldLegend variant="label">Who can find it?</FieldLegend>
            <RadioGroup name="visibility" defaultValue="public" className="gap-2">
              <VisibilityChoice
                value="public"
                title="Public"
                hint="Any Staff member can find, read and join it."
              />
              <VisibilityChoice
                value="private"
                title="Private"
                hint="Only its members can find and read it. It can’t be made Public later."
              />
            </RadioGroup>
            {visibilityIssue ? <FieldError>{visibilityIssue}</FieldError> : null}
          </FieldSet>
          {formError ? <FormError>{formError}</FormError> : null}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Creating…' : 'Create channel'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** One visibility option as a card: the radio, its name and what it means. */
function VisibilityChoice({ value, title, hint }: { value: string; title: string; hint: string }) {
  const id = `create-channel-${value}`;
  return (
    <FieldLabel htmlFor={id}>
      <Field orientation="horizontal">
        <RadioGroupItem value={value} id={id} />
        <FieldContent>
          <FieldTitle>{title}</FieldTitle>
          <FieldDescription>{hint}</FieldDescription>
        </FieldContent>
      </Field>
    </FieldLabel>
  );
}
