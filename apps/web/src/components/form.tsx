// Ping's forms (ADR 0008): TanStack Form, with the zod schemas from packages/shared as
// validators and the Field components from components/ui. A form calls useAppForm and
// builds from the bound pieces below, so every field gets the same wiring: its label,
// aria-invalid, the error tied to it by aria-describedby, and focus on submit.
//
//   const form = useAppForm({
//     formId: 'create-channel',
//     defaultValues: { name: '' },
//     validationLogic: revalidateLogic(),
//     validators: { onDynamic: createChannelBody },
//     onSubmit: async ({ value }) => { ... },
//   });
//   <form.AppForm>
//     <form.Form>
//       <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
//       <form.SubmitButton pending="Creating…">Create channel</form.SubmitButton>
//     </form.Form>
//   </form.AppForm>

import type { MentionCandidate, RichTextDoc } from '@ping/shared';
import {
  type AnyFieldApi,
  type AnyFormApi,
  createFormHook,
  createFormHookContexts,
  useStore,
} from '@tanstack/react-form';
import type { ComponentProps, FormEvent, ReactNode } from 'react';
import { type AddAttachment, AttachmentPicker } from '#/components/attachments/AttachmentPicker';
import { RichTextEditor } from '#/components/rich-text/RichTextEditor';
import { Button } from '#/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { RadioGroup } from '#/components/ui/radio-group';
import { Textarea } from '#/components/ui/textarea';
import type { FieldIssue } from '#/lib/api-client';
import { controlId, firstMessage, serverFieldErrors } from '#/lib/form-issues';

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

/**
 * What every bound field needs: its control's id, its error, and the props that tie the
 * two together. A custom field (RichTextField, below) uses this to get the same wiring.
 * @public
 */
export function useFieldWiring<TValue>() {
  const field = useFieldContext<TValue>();
  const id = controlId(field.form.formId, field.name);
  const error = firstMessage(field.state.meta.errors);
  const errorId = `${id}-error`;
  return {
    field,
    id,
    error,
    /** Spread on the Field around the control. */
    fieldProps: { 'data-invalid': error ? true : undefined },
    /** Spread on the control itself: the element that takes focus. */
    controlProps: {
      id,
      'data-field': field.name,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? errorId : undefined,
    },
    errorNode: error ? <FieldError id={errorId}>{error}</FieldError> : null,
    /** Sets the value and drops the server's issue for this field, which is now stale. */
    change(value: TValue) {
      field.handleChange(value as Parameters<typeof field.handleChange>[0]);
      clearServerError(field);
    },
  };
}

function clearServerError(field: AnyFieldApi) {
  if (field.state.meta.errorMap.onServer === undefined) return;
  field.setMeta((meta) => ({ ...meta, errorMap: { ...meta.errorMap, onServer: undefined } }));
}

/** Props the wiring owns; a caller can't pass them, so nothing is silently overridden. */
type WiredProps =
  | 'id'
  | 'name'
  | 'value'
  | 'onChange'
  | 'onBlur'
  | 'aria-invalid'
  | 'aria-describedby'
  | 'data-field';

type TextControlProps = Omit<ComponentProps<'input'>, WiredProps>;

function TextField({
  label,
  description,
  ...props
}: TextControlProps & {
  label: ReactNode;
  /** A hint under the field, such as a password rule. Read out with the control. */
  description?: ReactNode;
}) {
  const { field, id, fieldProps, controlProps, errorNode, change } = useFieldWiring<string>();
  const descriptionId = `${id}-description`;
  const describedBy =
    [controlProps['aria-describedby'], description ? descriptionId : undefined]
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <Field {...fieldProps}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        {...props}
        {...controlProps}
        aria-describedby={describedBy}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => change(event.target.value)}
      />
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {errorNode}
    </Field>
  );
}

type TextareaControlProps = Omit<ComponentProps<'textarea'>, WiredProps>;

function TextareaField({ label, ...props }: TextareaControlProps & { label: ReactNode }) {
  const { field, id, fieldProps, controlProps, errorNode, change } = useFieldWiring<string>();
  return (
    <Field {...fieldProps}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Textarea
        {...props}
        {...controlProps}
        name={field.name}
        value={field.state.value}
        onBlur={field.handleBlur}
        onChange={(event) => change(event.target.value)}
      />
      {errorNode}
    </Field>
  );
}

/** A set of radio choices. Its children are the RadioGroupItems, laid out as the form needs. */
function RadioGroupField({ legend, children }: { legend: ReactNode; children: ReactNode }) {
  const { field, id, fieldProps, controlProps, errorNode, change } = useFieldWiring<string>();
  return (
    <FieldSet {...fieldProps}>
      <FieldLegend id={`${id}-legend`} variant="label">
        {legend}
      </FieldLegend>
      <RadioGroup
        {...controlProps}
        aria-labelledby={`${id}-legend`}
        name={field.name}
        value={field.state.value}
        onValueChange={(value) => change(String(value))}
        className="gap-2"
      >
        {children}
      </RadioGroup>
      {errorNode}
    </FieldSet>
  );
}

/**
 * A rich-text field: the TipTap editor (ADR 0003). Its editable element is a div, which a
 * <label> can't point at, so the label names it through aria-labelledby, and the wiring's
 * id, data-field and aria attributes go on that div, the element that takes focus.
 */
function RichTextField({
  label,
  mentionCandidates,
}: {
  label: ReactNode;
  /** Who the @ picker offers: the Staff members who can read the Thread. */
  mentionCandidates: readonly MentionCandidate[];
}) {
  const { field, id, fieldProps, controlProps, errorNode, change } = useFieldWiring<RichTextDoc>();
  const labelId = `${id}-label`;
  const attributes: Record<string, string> = {
    id,
    'data-field': field.name,
    'aria-labelledby': labelId,
  };
  if (controlProps['aria-invalid']) attributes['aria-invalid'] = 'true';
  if (controlProps['aria-describedby']) {
    attributes['aria-describedby'] = controlProps['aria-describedby'];
  }
  return (
    <Field {...fieldProps}>
      <FieldTitle id={labelId}>{label}</FieldTitle>
      <RichTextEditor
        defaultValue={field.state.value}
        attributes={attributes}
        onChange={change}
        onBlur={field.handleBlur}
        mentionCandidates={mentionCandidates}
      />
      {errorNode}
    </Field>
  );
}

/**
 * The composer's Attachments: files added while writing, held as the IDs of the added
 * ones. `onAddingChange` tells the composer how many are still being sent, so it can wait
 * for them before saving.
 */
function AttachmentsField({
  add,
  onAddingChange,
  alreadyAttached,
}: {
  add: AddAttachment;
  onAddingChange(count: number): void;
  /** When editing, how many Attachments the post already has. */
  alreadyAttached?: number;
}) {
  const { controlProps, fieldProps, errorNode, change } = useFieldWiring<string[]>();
  return (
    <Field {...fieldProps}>
      <AttachmentPicker
        add={add}
        onChange={change}
        onAddingChange={onAddingChange}
        alreadyAttached={alreadyAttached}
        describedBy={controlProps['aria-describedby']}
      />
      {errorNode}
    </Field>
  );
}

/**
 * The <form> element. It submits through TanStack Form, then moves focus to the first field
 * with an error, in page order, whether the schema or the server found it.
 */
function Form({ className, children }: { className?: string; children: ReactNode }) {
  const form = useFormContext();
  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    const element = event.currentTarget;
    await form.handleSubmit();
    focusFirstInvalid(element, form);
  }
  return (
    <form
      id={form.formId}
      className={className}
      noValidate
      onSubmit={(event) => void onSubmit(event)}
    >
      {children}
    </form>
  );
}

function focusFirstInvalid(element: HTMLFormElement, form: AnyFormApi) {
  const fieldMeta: Record<string, { errors?: unknown[] } | undefined> = form.state.fieldMeta;
  const invalid = new Set(
    Object.entries(fieldMeta)
      .filter(([, meta]) => firstMessage(meta?.errors ?? []) !== undefined)
      .map(([name]) => name),
  );
  if (invalid.size === 0) return;
  for (const control of element.querySelectorAll<HTMLElement>('[data-field]')) {
    if (!invalid.has(control.dataset.field ?? '')) continue;
    // A radio group's root isn't focusable; its checked (or first) radio is.
    const target =
      control.tabIndex >= 0
        ? control
        : (control.querySelector<HTMLElement>('[role="radio"][tabindex="0"]') ??
          control.querySelector<HTMLElement>('[role="radio"]'));
    target?.focus();
    return;
  }
}

/** The submit button: disabled, with its pending label, while the form is submitting. */
function SubmitButton({
  pending,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'type' | 'disabled'> & { pending: ReactNode }) {
  const form = useFormContext();
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  return (
    <Button {...props} type="submit" disabled={submitting}>
      {submitting ? pending : children}
    </Button>
  );
}

export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: {
    TextField,
    TextareaField,
    RadioGroupField,
    RichTextField,
    AttachmentsField,
  },
  formComponents: { Form, SubmitButton },
});

/**
 * Puts the server's field issues (ApiError.issues) on their fields. Call it from the form's
 * onSubmit when the mutation fails; the Form then focuses the first one. Returns whether every
 * issue landed on a field. When not (no issues, or one for a path the form has no field
 * for), the caller still shows the error's message as a form-level failure.
 */
export function showServerIssues(form: AnyFormApi, issues: readonly FieldIssue[]): boolean {
  const errors = serverFieldErrors(issues, Object.keys(form.fieldInfo));
  for (const [name, message] of Object.entries(errors)) {
    form.setFieldMeta(name, (meta) => ({
      ...meta,
      errorMap: { ...meta.errorMap, onServer: message },
    }));
  }
  return issues.length > 0 && issues.every((issue) => Object.hasOwn(errors, issue.path));
}
