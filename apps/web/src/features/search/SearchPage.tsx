// The search screen (screens.md › Search, product.md › Search): the chips, the All,
// Channels and Threads tabs, and the results. Everything it shows comes from the URL.
import type { SearchRouteSearch, SearchTab } from '@ping/shared';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { Button } from '#/components/ui/button';
import { useChannelSearch, useThreadSearch } from './api';
import { ChannelResult, ThreadResult } from './results';
import { SearchChips } from './SearchChips';
import { SearchField } from './SearchField';

/** How many Channels the All tab shows above the Threads. */
const ALL_TAB_CHANNELS = 3;

const TAB_LABEL: Record<SearchTab, string> = {
  all: 'All',
  channels: 'Channels',
  threads: 'Threads',
};

const TAB_CLASS =
  'border-b-2 border-transparent pb-1.5 text-small font-semibold text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground';

export function SearchPage() {
  const search = useSearch({ from: '/search' });
  const navigate = useNavigate({ from: '/search' });
  const change = (next: Partial<SearchRouteSearch>) =>
    void navigate({ search: { ...search, ...next }, replace: true });

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <h1 className="sr-only">Search</h1>
      {/* The top bar holds the search bar on a laptop; a phone shows it here. */}
      <SearchField tone="panel" className="mb-3 md:hidden" />
      <SearchChips search={search} onChange={change} />
      <nav className="mt-3 flex gap-4 border-b" aria-label="Search results">
        {(Object.keys(TAB_LABEL) as SearchTab[]).map((tab) => (
          <Link
            key={tab}
            to="/search"
            search={{ ...search, tab }}
            replace
            // The router marks the current tab with aria-current="page": the same search
            // with this tab.
            className={TAB_CLASS}
          >
            {TAB_LABEL[tab]}
          </Link>
        ))}
      </nav>
      {search.q.trim() === '' ? (
        <div className="mx-auto my-12 max-w-md text-center">
          <p className="font-semibold">Search Ping</p>
          <p className="text-muted-foreground">
            Type to find Channels and Threads in Public channels and the Private channels you’re in.
          </p>
        </div>
      ) : (
        <Results search={search} />
      )}
    </div>
  );
}

function Results({ search }: { search: SearchRouteSearch }) {
  // The chips narrow Threads. With In or From set, the All tab keeps to Threads too.
  const narrowed = search.in !== undefined || search.from !== undefined;
  const showChannels = search.tab === 'channels' || (search.tab === 'all' && !narrowed);
  const showThreads = search.tab !== 'channels';
  return (
    <div className="mt-4 grid gap-6">
      {showChannels ? (
        <ChannelResults
          search={search}
          limit={search.tab === 'all' ? ALL_TAB_CHANNELS : undefined}
        />
      ) : null}
      {showThreads ? <ThreadResults search={search} heading={search.tab === 'all'} /> : null}
    </div>
  );
}

function ChannelResults({
  search,
  limit,
}: {
  search: SearchRouteSearch;
  limit: number | undefined;
}) {
  const channels = useChannelSearch(search.q);
  if (channels.isPending) return <Loading />;
  if (channels.isError) return <Failure message={channels.error.message} />;
  const all = channels.data.channels;
  // The All tab skips an empty Channels list: the Threads below say if nothing matched.
  if (all.length === 0) {
    return limit === undefined ? <Empty title="No Channels match" /> : null;
  }
  const shown = limit === undefined ? all : all.slice(0, limit);
  return (
    <section aria-label="Channels">
      {limit === undefined ? null : (
        <h2 className="mb-2 text-small font-semibold text-muted-foreground">Channels</h2>
      )}
      <ul className="grid gap-2">
        {shown.map((channel) => (
          <li key={channel.id}>
            <ChannelResult channel={channel} />
          </li>
        ))}
      </ul>
      {all.length > shown.length ? (
        <Link
          to="/search"
          search={{ ...search, tab: 'channels' }}
          replace
          className="mt-2 inline-block text-small font-semibold text-primary hover:underline"
        >
          See all {all.length} Channels
        </Link>
      ) : null}
    </section>
  );
}

function ThreadResults({ search, heading }: { search: SearchRouteSearch; heading: boolean }) {
  const threads = useThreadSearch({
    q: search.q,
    in: search.in,
    from: search.from,
    status: search.status,
  });
  if (threads.isPending) return <Loading />;
  if (threads.isError) return <Failure message={threads.error.message} />;
  const rows = threads.data.pages.flatMap((page) => page.threads);
  if (rows.length === 0) {
    return (
      <Empty
        title="No Threads match"
        note={
          search.in || search.from || search.status !== 'all'
            ? 'Try removing a filter.'
            : 'Every word must match. Try fewer or different words.'
        }
      />
    );
  }
  return (
    <section aria-label="Threads">
      {heading ? (
        <h2 className="mb-2 text-small font-semibold text-muted-foreground">Threads</h2>
      ) : null}
      <ul className="grid gap-2">
        {rows.map((thread) => (
          <li key={thread.id}>
            <ThreadResult thread={thread} />
          </li>
        ))}
      </ul>
      {threads.hasNextPage ? (
        <div className="mt-3 flex justify-center">
          <Button
            variant="outline"
            disabled={threads.isFetchingNextPage}
            onClick={() => void threads.fetchNextPage()}
          >
            {threads.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function Loading() {
  return <p className="py-6 text-center text-muted-foreground">Loading…</p>;
}

function Failure({ message }: { message: string }) {
  return (
    <p className="py-6 text-center text-destructive" role="alert">
      {message}
    </p>
  );
}

function Empty({ title, note }: { title: string; note?: string }) {
  return (
    <div className="mx-auto my-8 max-w-md text-center">
      <p className="font-semibold">{title}</p>
      {note ? <p className="text-muted-foreground">{note}</p> : null}
    </div>
  );
}
