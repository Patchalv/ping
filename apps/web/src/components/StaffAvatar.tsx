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
};

/**
 * Decorative: the name always sits beside it, or in the control's label, so screen
 * readers skip it.
 */
export function StaffAvatar({ staff, size, shape = 'round' }: Props) {
  const corners = shape === 'square' ? 'rounded-md after:rounded-md' : undefined;
  return (
    <Avatar aria-hidden="true" size={size} className={cn('after:border-0', corners)}>
      <AvatarFallback
        className={cn(
          'font-bold',
          size === 'sm' ? undefined : 'text-small',
          avatarColour(staff.id),
          shape === 'square' ? 'rounded-md' : undefined,
        )}
      >
        {initials(staff.name)}
      </AvatarFallback>
    </Avatar>
  );
}
