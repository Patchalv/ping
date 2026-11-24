// The search bar (screens.md › Search): in the top bar on a laptop, behind an icon on a
// phone. Anywhere but the search screen, clicking it or typing in it, ⌘K or Ctrl+K, or /
// opens the search dialog over the current view. On the search screen the bar edits the
// screen's text in place, which lives in the URL, and each key updates the results.
import { SEARCH_TEXT_MAX, searchRouteSearch } from '@ping/shared';
import { useNavigate, useParams, useRouterState } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { cn } from '#/lib/utils';
import { SearchDialog, type SearchOpening } from './SearchDialog';

/** Whether a key pressed here is typing, so / must not open search. */
const isTextField = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/** The search screen's own text box that's showing: the top bar's, or a phone's. */
const visibleSearchField = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[data-search-field]')).find(
    (input) => input.offsetParent !== null,
  );

/**
 * The top bar's search: the bar, the phone's icon and the dialog they open. The dialog's
 * last text is kept here, in the app's shell, so it reopens with it; a reload clears it.
 */
export function TopBarSearch() {
  const onSearch = useRouterState({ select: (s) => s.location.pathname === '/search' });
  const { channelId } = useParams({ strict: false });
  const [dialog, setDialog] = useState<{ open: boolean; opening: SearchOpening }>({
    open: false,
    opening: 'resume',
  });
  const [text, setText] = useState('');
  const barRef = useRef<HTMLInputElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);

  const openDialog = (opening: SearchOpening, typed?: string) => {
    if (typed !== undefined) setText(typed);
    setDialog({ open: true, opening });
  };

  // eslint-disable-next-line no-restricted-syntax -- syncs with document keyboard events: ⌘K or Ctrl+K, or / outside a text field, opens search
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const isK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const isSlash =
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTextField(event.target);
      if (!isK && !isSlash) return;
      event.preventDefault();
      if (onSearch) visibleSearchField()?.select();
      else setDialog((current) => (current.open ? current : { open: true, opening: 'resume' }));
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onSearch]);

  return (
    <>
      {onSearch ? (
        <>
          <SearchField tone="chrome" className="mx-auto w-full max-w-xl max-md:hidden" />
          {/* A phone's search screen shows its own box: keep the bar's end where it was. */}
          <span className="ml-auto md:hidden" />
        </>
      ) : (
        <>
          <div className="relative mx-auto w-full max-w-xl max-md:hidden">
            <SearchFieldIcon tone="chrome" />
            <Input
              ref={barRef}
              className={cn('pl-8', CHROME_INPUT)}
              type="search"
              placeholder="Search Channels and Threads"
              aria-label="Search"
              aria-haspopup="dialog"
              aria-keyshortcuts="Meta+K Control+K /"
              value=""
              onClick={() => openDialog('resume')}
              onChange={(event) => openDialog('typing', event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'ArrowDown') {
                  event.preventDefault();
                  openDialog('resume');
                }
              }}
            />
          </div>
          {/* Search sits behind an icon on a phone (screens.md › Phone). */}
          <Button
            ref={iconRef}
            variant="chrome"
            size="icon-sm"
            className="ml-auto md:hidden"
            aria-label="Search"
            aria-haspopup="dialog"
            onClick={() => openDialog('resume')}
          >
            <SearchIcon aria-hidden="true" />
          </Button>
        </>
      )}
      <SearchDialog
        open={dialog.open}
        opening={dialog.opening}
        text={text}
        channelId={channelId}
        onTextChange={setText}
        onClose={() => setDialog((current) => ({ ...current, open: false }))}
        returnFocus={() =>
          barRef.current?.offsetParent ? barRef.current : (iconRef.current ?? null)
        }
      />
    </>
  );
}

const CHROME_INPUT =
  'h-7 border-chrome-foreground/15 bg-chrome-foreground/10 text-chrome-foreground shadow-none placeholder:text-chrome-foreground/70';

function SearchFieldIcon({ tone }: { tone: 'chrome' | 'panel' }) {
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
