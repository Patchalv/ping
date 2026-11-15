import type { ComponentProps } from 'react';
import { cn } from '#/lib/utils';

/** A failure no single field explains, such as the network or a refusal. Announced. */
export function FormError({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      role="alert"
      className={cn(
        'rounded-md bg-destructive-surface px-3 py-2 text-sm text-destructive',
        className,
      )}
      {...props}
    />
  );
}
