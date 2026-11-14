import {
  CHANNEL_DESCRIPTION_MAX,
  CHANNEL_NAME_MAX,
  type ChannelView,
  type CreateChannelBody,
  createChannelBody,
} from '@ping/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { createChannel } from './api';

type Props = { onClose(): void; onCreated(channel: ChannelView): void };

/** Create channel: name, description and visibility (screens.md › Other flows). */
export function CreateChannelDialog({ onClose, onCreated }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
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
      setError(parsed.error.issues[0]?.message ?? 'Check the form.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createChannel(parsed.data);
    setSubmitting(false);
    if (result.ok) onCreated(result.channel);
    else setError(result.message);
  }

  return (
    <dialog
      ref={dialog}
      className="dialog"
      aria-labelledby="create-channel-title"
      onClose={onClose}
    >
      <form className="dialog__form" onSubmit={(e) => void onSubmit(e)}>
        <h2 id="create-channel-title" className="dialog__title">
          Create a Channel
        </h2>
        <label className="field">
          <span className="field__label">Name</span>
          <input
            className="field__input"
            name="name"
            maxLength={CHANNEL_NAME_MAX}
            required
            autoComplete="off"
          />
        </label>
        <label className="field">
          <span className="field__label">Description</span>
          <textarea
            className="field__input field__input--area"
            name="description"
            maxLength={CHANNEL_DESCRIPTION_MAX}
            rows={3}
          />
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
        </fieldset>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog__actions">
          <button className="button" type="button" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button className="button button--primary" type="submit" disabled={submitting}>
            {submitting ? 'Creating…' : 'Create channel'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
