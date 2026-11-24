// The search bar (screens.md › Search): in the top bar on a laptop, and at the top of the
// search screen on a phone, where the top bar shows only an icon. Its text lives in the
// URL: clicking it or typing opens the search screen, whose chips and results sit below,
// and each key updates the results in place.
import { SEARCH_TEXT_MAX, type SearchRouteSearch, searchRouteSearch } from '@ping/shared';
import { Link, useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { buttonVariants } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { cn } from '#/lib/utils';

/** Where a fresh search starts: nothing typed, and In suggested for the Channel it's opened from. */
const freshSearch = (near: string | undefined): SearchRouteSearch => ({
  q: '',
  tab: 'all',
  status: 'all',
  ...(near ? { near } : {}),
});

export function SearchField({
  tone,
  className,
}: {
  /** `chrome` on the navy top bar; `panel` on the search screen itself. */
  tone: 'chrome' | 'panel';
  className?: string;
}) {
  const navigate = useNavigate();
  const onSearch = useRouterState({ select: (s) => s.location.pathname === '/search' });
  const current = useRouterState({
    select: (s) => (s.location.pathname === '/search' ? s.location.search.q : undefined),
  });
  const { channelId } = useParams({ strict: false });

  const open = (q: string) =>
    navigate({
      to: '/search',
      // On the search screen each key replaces the entry, so Back leaves search in one step.
      search: (prev) => ({
        ...(onSearch ? searchRouteSearch.parse(prev) : freshSearch(channelId)),
        q,
      }),
      replace: onSearch,
    });

  return (
    <div className={cn('relative', className)}>
      <SearchIcon
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2',
          tone === 'chrome' ? 'text-chrome-foreground/70' : 'text-muted-foreground',
        )}
      />
      <Input
        className={cn(
          'pl-8',
          tone === 'chrome' &&
            'h-7 border-chrome-foreground/15 bg-chrome-foreground/10 text-chrome-foreground shadow-none placeholder:text-chrome-foreground/70',
        )}
        type="search"
        maxLength={SEARCH_TEXT_MAX}
        placeholder="Search Channels and Threads"
        aria-label="Search"
        value={current ?? ''}
        onClick={() => {
          if (!onSearch) void open('');
        }}
        onChange={(event) => void open(event.target.value)}
      />
    </div>
  );
}

/** The phone's search icon in the top bar: opens the search screen. */
export function SearchIconLink() {
  const { channelId } = useParams({ strict: false });
  return (
    <Link
      to="/search"
      search={freshSearch(channelId)}
      aria-label="Search"
      className={cn(buttonVariants({ variant: 'chrome', size: 'icon-sm' }), 'ml-auto md:hidden')}
    >
      <SearchIcon aria-hidden="true" />
    </Link>
  );
}
