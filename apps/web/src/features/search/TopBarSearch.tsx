// The top bar's search (screens.md › Search): the search bar on a laptop, an icon on a
// phone, and the search dialog they open. Anywhere but the search screen, clicking or
// typing in the bar, ⌘K or Ctrl+K, or / outside a text field opens the dialog over the
// current view. On the search screen the bar edits the screen's text in place instead.
import { useParams, useRouterState } from '@tanstack/react-router';
import { SearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { cn } from '#/lib/utils';
import { SearchDialog, type SearchOpening } from './SearchDialog';
import { CHROME_INPUT, SearchField, SearchFieldIcon } from './SearchField';

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
