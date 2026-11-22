// A Staff member's coloured initials (product.md › Profiles: no photos in the MVP). The
// name is read at view time, so a new display name shows wherever the avatar does.
import type { ComponentProps } from 'react';
import { Avatar, AvatarFallback } from '#/components/ui/avatar';
import { avatarColour, initials } from '#/lib/avatar';
import { cn } from '#/lib/utils';

type Props = {
  staff: { id: string; name: string };
  size?: ComponentProps<typeof Avatar>['size'];
  /** Round everywhere, except the top bar's 8px-rounded square (DESIGN.md › Shapes). */
  shape?: 'round' | 'square';
  /** A Deactivated Staff member shows greyed (product.md › Deactivation). */
  tone?: 'active' | 'deactivated';
};

const CORNERS = {
  round: { root: undefined, fallback: undefined },
  square: { root: 'rounded-md after:rounded-md', fallback: 'rounded-md' },
} as const;

/**
 * Decorative: the name always sits beside it, or in the control's label, so screen
 * readers skip it.
 */
export function StaffAvatar({ staff, size, shape = 'round', tone = 'active' }: Props) {
  const corners = CORNERS[shape];
  return (
    <Avatar aria-hidden="true" size={size} className={cn('after:border-0', corners.root)}>
      <AvatarFallback
        className={cn(
          'font-bold',
          size === 'sm' ? undefined : 'text-small',
          tone === 'deactivated' ? 'bg-muted text-muted-foreground' : avatarColour(staff.id),
          corners.fallback,
        )}
      >
        {initials(staff.name)}
      </AvatarFallback>
    </Avatar>
  );
}
