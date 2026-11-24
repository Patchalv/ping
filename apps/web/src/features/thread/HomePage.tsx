import { Link } from '@tanstack/react-router';
import { BellIcon, BookmarkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '#/components/ui/button';
import { cn } from '#/lib/utils';
import { usePingSummary, useSavedSummary } from './api';
import { type HomeCountState, homeCountState } from './home-count';

/**
 * The home route's main area on a laptop: how many Threads have a Ping and how many are
 * Saved, each a link to its view (screens.md › Home). On a phone it's hidden: the sidebar
 * is home.
 */
export function HomePage() {
  const pings = usePingSummary();
  const saved = useSavedSummary();
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <h1 className="sr-only">Home</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <HomeCount
          to="/pings"
          label="Pings"
          icon={<BellIcon aria-hidden="true" />}
          tone="text-ping"
          state={homeCountState({ error: pings.error, data: pings.data?.threadCount })}
          unit={(count) => (count === 1 ? 'Thread with a Ping' : 'Threads with Pings')}
          empty="You’re all caught up"
          onRetry={() => void pings.refetch()}
        />
        <HomeCount
          to="/saved"
          label="Saved"
          icon={<BookmarkIcon aria-hidden="true" />}
          tone="text-saved"
          state={homeCountState({ error: saved.error, data: saved.data?.count })}
          unit={(count) => (count === 1 ? 'Saved Thread' : 'Saved Threads')}
          empty="Save a Thread to come back to it"
          onRetry={() => void saved.refetch()}
        />
      </div>
    </div>
  );
}

/** One tile: the number large and centred, what it counts under it, then the view's name. */
function HomeCount({
  to,
  label,
  icon,
  tone,
  state,
  unit,
  empty,
  onRetry,
}: {
  to: '/pings' | '/saved';
  label: string;
  icon: ReactNode;
  /** The signal colour the number takes (DESIGN.md › The Signal Rule). */
  tone: 'text-ping' | 'text-saved';
  state: HomeCountState;
  unit(count: number): string;
  empty: string;
  onRetry(): void;
}) {
  const name = (
    <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground [&_svg]:size-4">
      {icon}
      {label}
    </span>
  );
  // Every state keeps the same height, so nothing moves as the count arrives.
  const tile =
    'grid min-h-68 content-center justify-items-center gap-4 rounded-xl bg-card p-6 text-center text-card-foreground';
  const number = 'text-[5.5rem] leading-none font-bold tracking-[-0.03em] tabular-nums';

  if (state.status === 'error') {
    return (
      <section aria-label={label} className={tile}>
        <p className="text-destructive" role="alert">
          {state.message}
        </p>
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
        {name}
      </section>
    );
  }

  return (
    <Link
      to={to}
      className={cn(
        tile,
        'border border-transparent outline-none transition-colors hover:border-border focus-visible:ring-3 focus-visible:ring-ring/50',
      )}
    >
      {state.status === 'loading' ? (
        <span aria-hidden="true" className="grid justify-items-center gap-2">
          <span className="h-[5.5rem] w-24 animate-pulse rounded-lg bg-muted" />
          <span className="h-5 w-32 animate-pulse rounded bg-muted" />
        </span>
      ) : (
        <span className="grid justify-items-center gap-2">
          <span className={cn(number, state.status === 'empty' ? 'text-muted-foreground' : tone)}>
            {state.status === 'empty' ? 0 : state.count}
          </span>
          <span className="text-sm text-muted-foreground">
            {state.status === 'empty' ? empty : unit(state.count)}
          </span>
        </span>
      )}
      {name}
    </Link>
  );
}
