import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('keeps the custom 13px step next to a text colour', () => {
    expect(cn('text-small font-medium text-muted-foreground')).toBe(
      'text-small font-medium text-muted-foreground',
    );
  });

  it('lets a later font size replace text-small', () => {
    expect(cn('text-small', 'text-sm')).toBe('text-sm');
  });
});
