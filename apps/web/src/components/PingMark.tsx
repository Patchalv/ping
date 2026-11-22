import { cn } from '#/lib/utils';

/**
 * Ping's logo mark: a bolt with two signal waves, in Spark Orange (DESIGN.md › Brand).
 * Decorative: it always sits next to the visible "Ping" wordmark, which carries the name.
 * The favicon (public/favicon.svg) draws the same paths on a navy tile.
 */
export function PingMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={cn('shrink-0 text-brand-mark', className)}
    >
      <path
        d="M15 2 4.5 17H11.5L9.5 30 20 14.5H13Z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M22.5 11.3a5.5 5.5 0 0 1 0 8.4M25.4 7.8a10 10 0 0 1 0 15.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
