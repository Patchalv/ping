import { Button } from '#/components/ui/button';
import { useSaved } from './api';
import { ThreadRow } from './ThreadList';

/**
 * The Saved view: the Threads you Saved to come back to, as the same rows a Channel's feed
 * shows, with the Channel name, newest saved first (screens.md › Pings and Saved views).
 */
export function SavedPage() {
  const saved = useSaved();
  const rows = saved.data?.pages.flatMap((page) => page.threads) ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-4 md:px-6">
      <h1 className="mb-3 text-lg font-bold">Saved</h1>
      {saved.isPending ? (
        <p className="py-10 text-center text-muted-foreground">Loading…</p>
      ) : saved.isError ? (
        <p className="py-10 text-center text-destructive" role="alert">
          {saved.error.message}
        </p>
      ) : rows.length === 0 ? (
        <div className="mx-auto my-12 max-w-md text-center">
          <p className="font-semibold">Nothing Saved yet</p>
          <p className="text-muted-foreground">
            Save a Thread to read it later, respond to it or act on it. Only you see this list.
          </p>
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
          {saved.hasNextPage ? (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                disabled={saved.isFetchingNextPage}
                onClick={() => void saved.fetchNextPage()}
              >
                {saved.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
