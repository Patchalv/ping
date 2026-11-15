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
import {
  type AnyFieldApi,
  type AnyFormApi,
  createFormHook,
  createFormHookContexts,
  useStore,
} from '@tanstack/react-form';
import type { ComponentProps, FormEvent, ReactNode } from 'react';
import { Button } from '#/components/ui/button';
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '#/components/ui/field';
import { Input } from '#/components/ui/input';
import { RadioGroup } from '#/components/ui/radio-group';
import { Textarea } from '#/components/ui/textarea';
import type { FieldIssue } from '#/lib/api-client';
import { controlId, firstMessage, serverFieldErrors } from '#/lib/form-issues';

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

/**
 * What every bound field needs: its control's id, its error, and the props that tie the
 * two together. A custom field (the TipTap editor in #38) uses this to get the same wiring.
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

type TextControlProps = Omit<ComponentProps<'input'>, 'id' | 'name' | 'value' | 'onChange'>;

function TextField({ label, ...props }: TextControlProps & { label: ReactNode }) {
  const { field, id, fieldProps, controlProps, errorNode, change } = useFieldWiring<string>();
  return (
    <Field {...fieldProps}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
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

type TextareaControlProps = Omit<ComponentProps<'textarea'>, 'id' | 'name' | 'value' | 'onChange'>;

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
  const { field, controlProps, errorNode, change } = useFieldWiring<string>();
  return (
    <FieldSet data-invalid={controlProps['aria-invalid']}>
      <FieldLegend variant="label">{legend}</FieldLegend>
      <RadioGroup
        {...controlProps}
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
        : control.querySelector<HTMLElement>('[tabindex="0"], input:not([type="hidden"])');
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
  fieldComponents: { TextField, TextareaField, RadioGroupField },
  formComponents: { Form, SubmitButton },
});

/**
 * Puts the server's field issues (ApiError.issues) on their fields. Call it from the form's
 * onSubmit when the mutation fails; the Form then focuses the first one. Returns whether any
 * landed, so the caller knows whether a form-level message is still needed.
 */
export function showServerIssues(form: AnyFormApi, issues: readonly FieldIssue[]): boolean {
  const errors = serverFieldErrors(issues, Object.keys(form.fieldInfo));
  for (const [name, message] of Object.entries(errors)) {
    form.setFieldMeta(name, (meta) => ({
      ...meta,
      errorMap: { ...meta.errorMap, onServer: message },
    }));
  }
  return Object.keys(errors).length > 0;
}
