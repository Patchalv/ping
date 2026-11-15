import {
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  type ChannelView,
  type CreateChannelBody,
  createChannelBody,
} from '@ping/shared';
import { type FormEvent, useState } from 'react';
import { ApiError, type FieldIssue } from '../../lib/api-client';
import { useCreateChannel } from './api';

type Props = { onClose(): void; onCreated(channel: ChannelView): void };

/** Opens the native dialog as a modal once it's in the page. */
const showModal = (node: HTMLDialogElement | null) => {
  // React calls ref callbacks twice in StrictMode; a dialog already open stays open.
  if (node && !node.open) node.showModal();
};

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
    <dialog
      ref={showModal}
      className="dialog"
      aria-labelledby="create-channel-title"
      onClose={onClose}
    >
      <form className="dialog__form" onSubmit={onSubmit} noValidate>
        <h2 id="create-channel-title" className="dialog__title">
          Create a Channel
        </h2>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="field__input"
            name="name"
            maxLength={CHANNEL_NAME_MAX}
            autoComplete="off"
            aria-invalid={nameIssue ? true : undefined}
            aria-describedby={nameIssue ? 'create-channel-name-issue' : undefined}
          />
          {nameIssue ? (
            <span className="field__issue" id="create-channel-name-issue">
              {nameIssue}
            </span>
          ) : null}
        </label>
        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            className="field__input field__input--area"
            name="description"
            maxLength={CHANNEL_DESCRIPTION_MAX}
            rows={3}
            aria-invalid={descriptionIssue ? true : undefined}
            aria-describedby={descriptionIssue ? 'create-channel-description-issue' : undefined}
          />
          {descriptionIssue ? (
            <span className="field__issue" id="create-channel-description-issue">
              {descriptionIssue}
            </span>
          ) : null}
        </label>
        <fieldset className="choice">
          <legend className="field__label">Who can find it?</legend>
          <label className="choice__option">
            <input type="radio" name="visibility" value="public" defaultChecked />
            <span>
              <span className="choice__name">Public</span>
              <span className="choice__hint">Any Staff member can find, read and join it.</span>
            </span>
          </label>
          <label className="choice__option">
            <input type="radio" name="visibility" value="private" />
            <span>
              <span className="choice__name">Private</span>
              <span className="choice__hint">
                Only its members can find and read it. It can’t be made Public later.
              </span>
            </span>
          </label>
          {visibilityIssue ? <span className="field__issue">{visibilityIssue}</span> : null}
        </fieldset>
        {formError ? (
          <p className="form-error" role="alert">
            {formError}
          </p>
        ) : null}
        <div className="dialog__actions">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button button--primary" type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create channel'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
