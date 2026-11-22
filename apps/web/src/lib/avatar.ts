// Coloured initials: Ping has no profile photos in the MVP (product.md › Profiles).

/** Up to two initials, from the first two words of a display name. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/**
 * The avatar classes, one pair of tokens each (index.css › --avatar-N). Written out in
 * full so Tailwind finds them.
 */
export const AVATAR_COLOURS = [
  'bg-avatar-1 text-avatar-1-foreground',
  'bg-avatar-2 text-avatar-2-foreground',
  'bg-avatar-3 text-avatar-3-foreground',
  'bg-avatar-4 text-avatar-4-foreground',
  'bg-avatar-5 text-avatar-5-foreground',
  'bg-avatar-6 text-avatar-6-foreground',
] as const;

/**
 * A Staff member's avatar colour, from their ID rather than their name, so it stays the
 * same when they change their name, on every screen and every device.
 */
export function avatarColour(staffId: string): (typeof AVATAR_COLOURS)[number] {
  let hash = 0;
  for (const char of staffId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length] ?? AVATAR_COLOURS[0];
}
