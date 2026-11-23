import { Button } from '#/components/ui/button';
import { usePings } from './api';
import { ThreadRow } from './ThreadList';

/**
 * The Pings view: the Threads with a Ping for you, as the same rows a Channel's feed
 * shows, with the Channel name, by latest activity (screens.md › Pings and Saved views).
 */
export function PingsPage() {
  const pings = usePings();
  const rows = pings.data?.pages.flatMap((page) => page.threads) ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <h1 className="mb-3 text-lg font-bold">Pings</h1>
      {pings.isPending ? (
        <p className="py-10 text-center text-muted-foreground">Loading…</p>
      ) : pings.isError ? (
        <p className="py-10 text-center text-destructive" role="alert">
          {pings.error.message}
        </p>
      ) : rows.length === 0 ? (
        <div className="mx-auto my-12 max-w-md text-center">
          <p className="font-semibold">You’re all caught up</p>
          <p className="text-muted-foreground">New activity in your Threads shows up here.</p>
        </div>
      ) : (
        <>
          <ul className="grid gap-2">
            {rows.map((thread) => (
              <li key={thread.id}>
                <ThreadRow thread={thread} open={false} channelName={thread.channelName} />
              </li>
            ))}
          </ul>
          {pings.hasNextPage ? (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                disabled={pings.isFetchingNextPage}
                onClick={() => void pings.fetchNextPage()}
              >
                {pings.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
