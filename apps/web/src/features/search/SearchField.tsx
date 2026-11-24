// The search screen's text box (screens.md › Search), and the look it shares with the top
// bar's search bar. Its text lives in the URL, and each key updates the results.
import { SEARCH_TEXT_MAX, searchRouteSearch } from '@ping/shared';
import { useNavigate, useRouterState } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { Input } from '#/components/ui/input';
import { cn } from '#/lib/utils';

/** The search bar on the navy top bar. */
export const CHROME_INPUT =
  'h-7 border-chrome-foreground/15 bg-chrome-foreground/10 text-chrome-foreground shadow-none placeholder:text-chrome-foreground/70';

export function SearchFieldIcon({ tone }: { tone: 'chrome' | 'panel' }) {
  return (
    <SearchIcon
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2',
        tone === 'chrome' ? 'text-chrome-foreground/70' : 'text-muted-foreground',
      )}
    />
  );
}

/**
 * The search screen's text box: in the top bar on a laptop, and at the top of the screen
 * on a phone. Each key replaces the history entry, so Back leaves search in one step.
 */
export function SearchField({
  tone,
  className,
}: {
  /** `chrome` on the navy top bar; `panel` on the search screen itself. */
  tone: 'chrome' | 'panel';
  className?: string;
}) {
  const navigate = useNavigate({ from: '/search' });
  const q = useRouterState({
    select: (s) => (s.location.pathname === '/search' ? s.location.search.q : undefined),
  });

  return (
    <div className={cn('relative', className)}>
      <SearchFieldIcon tone={tone} />
      <Input
        data-search-field=""
        className={cn('pl-8', tone === 'chrome' && CHROME_INPUT)}
        type="search"
        maxLength={SEARCH_TEXT_MAX}
        placeholder="Search Channels and Threads"
        aria-label="Search"
        value={q ?? ''}
        onChange={(event) =>
          void navigate({
            search: (prev) => ({ ...searchRouteSearch.parse(prev), q: event.target.value }),
            replace: true,
          })
        }
      />
    </div>
  );
}
