// SPIKE (#67), thrown away: a new-Thread form with a TipTap description and a draft kept
// in this browser, to prove components/form.tsx can carry both before #38.
import { revalidateLogic } from '@tanstack/react-form';
import { EditorContent, type JSONContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useState } from 'react';
import { z } from 'zod';
import { useAppForm, useFieldWiring } from '#/components/form';
import { Field, FieldLabel } from '#/components/ui/field';
import { authClient } from '#/lib/auth-client';
import { readStored, writeStored } from '#/lib/storage';

const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] };

function hasText(node: JSONContent): boolean {
  if (node.text?.trim()) return true;
  return (node.content ?? []).some(hasText);
}

const newThreadBody = z.object({
  title: z.string().trim().min(1, 'Give the Thread a title.'),
  description: z.custom<JSONContent>((doc) => hasText(doc as JSONContent), 'Write a description.'),
});
type NewThread = { title: string; description: JSONContent };

/** Drafts are keyed by Staff member, so the next person on this browser never sees one. */
export function draftKey(staffId: string, channelId: string) {
  return `ping:draft:${staffId}:new-thread:${channelId}`;
}

function readDraft(key: string): NewThread | null {
  const raw = readStored(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as NewThread;
  } catch {
    return null;
  }
}

export function ThreadFormSpike() {
  const { data: session } = authClient.useSession();
  const key = draftKey(session?.user.id ?? 'nobody', 'spike-channel');
  // Restored once, when the form is created: no effect.
  const [initial, setInitial] = useState<NewThread>(
    () => readDraft(key) ?? { title: '', description: EMPTY_DOC },
  );
  const [sent, setSent] = useState<NewThread | null>(null);

  const form = useAppForm({
    formId: 'new-thread',
    defaultValues: initial,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: newThreadBody },
    // The draft is saved from the change itself: an event, not an effect.
    listeners: {
      onChange: ({ formApi }) => {
        // A debounced write can land after the Thread was sent: only a form with something
        // in it is a draft. (Not isDefaultValue: the defaults are the restored draft.)
        if (formApi.state.isSubmitting) return;
        const { title, description } = formApi.state.values;
        if (!title.trim() && !hasText(description)) localStorage.removeItem(key);
        else writeStored(key, JSON.stringify(formApi.state.values));
      },
      onChangeDebounceMs: 300,
    },
    onSubmit: async ({ value, formApi }) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      setSent(value);
      // The defaults were the restored draft; an empty form is the new default.
      const empty = { title: '', description: EMPTY_DOC };
      setInitial(empty);
      formApi.reset(empty);
      localStorage.removeItem(key);
    },
  });

  return (
    <div className="grid max-w-xl gap-4 p-6">
      <form.AppForm>
        <form.Form className="grid gap-4">
          <h1 className="text-lg font-bold">New Thread (spike)</h1>
          <form.AppField name="title">{(field) => <field.TextField label="Title" />}</form.AppField>
          <form.AppField name="description">{() => <DescriptionField />}</form.AppField>
          <form.SubmitButton pending="Posting…">Post Thread</form.SubmitButton>
        </form.Form>
      </form.AppForm>
      {sent ? <pre className="text-xs">{JSON.stringify(sent)}</pre> : null}
    </div>
  );
}

/** A TipTap editor as a bound field: the same id, aria wiring and focus as any other. */
function DescriptionField() {
  const { field, id, fieldProps, controlProps, errorNode, change } =
    useFieldWiring<JSONContent>();
  const editor = useEditor({
    extensions: [StarterKit],
    content: field.state.value,
    immediatelyRender: true,
    editorProps: {
      attributes: {
        id,
        'data-field': controlProps['data-field'],
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-labelledby': `${id}-label`,
        ...(controlProps['aria-invalid'] ? { 'aria-invalid': 'true' } : {}),
        ...(controlProps['aria-describedby']
          ? { 'aria-describedby': controlProps['aria-describedby'] }
          : {}),
        class:
          'min-h-24 rounded-lg border border-input px-2.5 py-1.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/30 aria-invalid:border-destructive',
      },
    },
    onUpdate: ({ editor: e }) => change(e.getJSON()),
    onBlur: () => field.handleBlur(),
  });
  // A reset (after sending) puts the empty doc back into the field; the editor follows.
  if (editor && field.state.value === EMPTY_DOC && !editor.isEmpty) {
    editor.commands.setContent(EMPTY_DOC, { emitUpdate: false });
  }
  return (
    <Field {...fieldProps}>
      <FieldLabel id={`${id}-label`} onClick={() => editor?.commands.focus()}>
        Description
      </FieldLabel>
      <EditorContent editor={editor} />
      {errorNode}
    </Field>
  );
}
