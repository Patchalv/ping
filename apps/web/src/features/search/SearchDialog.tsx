// The search dialog (screens.md › Search): opens over the current Channel or Thread, which
// stays mounted beneath it, and never changes the route while open. It lists a few quick
// results as you type and hands off to the search screen on Enter. Opened from a Channel,
// it also offers to search only that Channel's Threads.
//
// An input with role combobox drives a listbox: the highlighted row is the input's
// aria-activedescendant, so focus never leaves the input.
import { SEARCH_TEXT_MAX, searchRouteSearch } from '@ping/shared';
import { useNavigate } from '@tanstack/react-router';
import { HashIcon, Loader2Icon, LockIcon, SearchIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, type RefObject, useId, useRef, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '#/components/ui/dialog';
import { cn } from '#/lib/utils';
import { useChipChannel, useQuickChannelSearch, useQuickThreadSearch } from './api';
import {
  FRESH_HIGHLIGHT,
  type Highlight,
  markTitle,
  moveHighlight,
  QUICK_THREADS,
  type QuickRow,
  type QuickScope,
  quickRows,
} from './quick-search';
import { ArchivedBadge, Snippet } from './SearchResults';

/**
 * How the dialog was opened: by typing in the search bar, which leaves the caret after the
 * typed text, or otherwise, which selects the last text so typing replaces it.
 */
export type SearchOpening = 'typing' | 'resume';

export function SearchDialog({
  open,
  opening,
  text,
  channelId,
  onTextChange,
  onClose,
  returnFocus,
}: {
  open: boolean;
  opening: SearchOpening;
  text: string;
  /** The Channel it was opened from, if any: "Only in" offers it. */
  channelId: string | undefined;
  onTextChange(text: string): void;
  onClose(): void;
  /** Where focus goes on close: the search bar, or the phone's search icon. */
  returnFocus(): HTMLElement | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent
        initialFocus={() => {
          const input = inputRef.current;
          if (input && opening === 'resume') input.select();
          else input?.setSelectionRange(input.value.length, input.value.length);
          return input;
        }}
        finalFocus={() => returnFocus() ?? true}
        // Anchored under the top bar on a laptop; a full-screen sheet on a phone.
        className={cn(
          'top-1.5 flex max-h-[min(36rem,calc(100dvh-3rem))] translate-y-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-xl',
          'max-md:top-0 max-md:left-0 max-md:h-dvh max-md:max-h-none max-md:max-w-none max-md:translate-x-0 max-md:rounded-none',
        )}
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <SearchBox
          inputRef={inputRef}
          text={text}
          channelId={channelId}
          onTextChange={onTextChange}
          onClose={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}

function SearchBox({
  inputRef,
  text,
  channelId,
  onTextChange,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  text: string;
  channelId: string | undefined;
  onTextChange(text: string): void;
  onClose(): void;
}) {
  const navigate = useNavigate();
  const listboxId = useId();
  const [highlight, setHighlight] = useState<Highlight>(FRESH_HIGHLIGHT);
  const q = text.trim();

  const scopeChannel = useChipChannel(channelId);
  const scope: QuickScope | undefined =
    channelId && scopeChannel.data ? { channelId, channelName: scopeChannel.data.name } : undefined;
  const scoped = scope !== undefined && highlight.scoped;
  const channels = useQuickChannelSearch(q);
  const threads = useQuickThreadSearch(q, scoped ? scope.channelId : undefined, QUICK_THREADS);

  const rows = quickRows({
    scope,
    scoped,
    channels: channels.data?.channels ?? [],
    threads: threads.data?.threads ?? [],
  });
  const active = Math.min(highlight.index, rows.length - 1);
  const fetching = channels.isFetching || threads.isFetching;
  const settled = channels.data !== undefined && threads.data !== undefined && !fetching;
  const nothingMatches = settled && rows.every((row) => row.kind === 'all' || row.kind === 'only');

  const choose = (row: QuickRow) => {
    onClose();
    switch (row.kind) {
      case 'all':
        return void navigate({
          to: '/search',
          search: searchRouteSearch.parse({ q, ...(channelId ? { near: channelId } : {}) }),
        });
      case 'only':
        return void navigate({
          to: '/search',
          search: searchRouteSearch.parse({
            q,
            in: row.channelId,
            tab: 'threads',
            status: 'all',
          }),
        });
      case 'channel':
        return void navigate({
          to: '/channels/$channelId',
          params: { channelId: row.channel.id },
        });
      case 'thread':
        return void navigate({
          to: '/channels/$channelId/threads/$threadId',
          params: { channelId: row.thread.channelId, threadId: row.thread.id },
          search: row.thread.response ? { response: row.thread.response.id } : {},
        });
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (q === '') return;
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((current) => moveHighlight({ ...current, index: active }, rows, delta));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (q === '') return;
      const only = rows.find((row) => row.kind === 'only');
      const row = event.shiftKey && only ? only : rows[active];
      if (row) choose(row);
    }
  };

  const optionId = (index: number) => `${listboxId}-${index}`;
  const showList = q !== '';
  const indexed = rows.map((row, index) => ({ row, index }));
  const option = ({ row, index }: { row: QuickRow; index: number }) => (
    <QuickOption
      key={optionId(index)}
      id={optionId(index)}
      selected={index === active}
      onHover={() =>
        index === active
          ? undefined
          : setHighlight((current) => moveHighlight({ ...current, index }, rows, 0))
      }
      onChoose={() => choose(row)}
    >
      <RowContent row={row} q={q} />
    </QuickOption>
  );
  const actions = indexed.filter(({ row }) => row.kind === 'all' || row.kind === 'only');
  const channelRows = indexed.filter(({ row }) => row.kind === 'channel');
  const threadRows = indexed.filter(({ row }) => row.kind === 'thread');

  return (
    <>
      <div className="flex items-center gap-2 border-b px-3">
        <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search Channels and Threads"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? optionId(active) : undefined}
          maxLength={SEARCH_TEXT_MAX}
          placeholder="Search Channels and Threads"
          value={text}
          onChange={(event) => {
            onTextChange(event.target.value);
            setHighlight(FRESH_HIGHLIGHT);
          }}
          onKeyDown={onKeyDown}
          className="h-12 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
        />
        {fetching ? (
          <Loader2Icon
            aria-label="Searching"
            className="size-4 shrink-0 animate-spin text-muted-foreground"
          />
        ) : null}
        <DialogClose render={<Button variant="ghost" size="sm" className="md:hidden" />}>
          Cancel
        </DialogClose>
      </div>

      {showList ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Results"
          className="min-h-0 flex-1 overflow-y-auto p-1.5 max-md:pb-4"
        >
          {actions.map(option)}
          {channelRows.length > 0 ? (
            <QuickGroup label="Channels">{channelRows.map(option)}</QuickGroup>
          ) : null}
          {threadRows.length > 0 ? (
            <QuickGroup label="Threads">{threadRows.map(option)}</QuickGroup>
          ) : null}
          {nothingMatches ? (
            <p className="px-3 py-4 text-center text-muted-foreground">
              No Channels or Threads match
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center gap-4 border-t px-3 py-2 text-xs text-muted-foreground max-md:hidden">
        <span>
          <Kbd>↵</Kbd> all results
        </span>
        {scope ? (
          <span>
            <Kbd>⇧↵</Kbd> only in #{scope.channelName}
          </span>
        ) : null}
        <DialogClose className="ml-auto cursor-pointer hover:text-foreground">
          <Kbd>esc</Kbd> close
        </DialogClose>
      </div>
    </>
  );
}

function QuickOption({
  id,
  selected,
  onHover,
  onChoose,
  children,
}: {
  id: string;
  selected: boolean;
  onHover(): void;
  onChoose(): void;
  children: ReactNode;
}) {
  return (
    // Focus stays in the input, which handles the keys; a click chooses the option.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the input handles the keys for the list.
    <div
      id={id}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
      // Keeps focus in the input, where the keys are read.
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={onHover}
      onClick={onChoose}
      className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 aria-selected:bg-accent aria-selected:text-accent-foreground"
    >
      {children}
    </div>
  );
}

/** Channels or Threads, under a heading, inside the one listbox. */
function QuickGroup({ label, children }: { label: string; children: ReactNode }) {
  const headingId = useId();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of options inside a listbox, which fieldset isn't.
    <div role="group" aria-labelledby={headingId} className="mt-2">
      <div id={headingId} className="px-3 pt-1 pb-1 text-xs font-semibold text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

/** What a row shows. Matched words are marked in titles and names only. */
function RowContent({ row, q }: { row: QuickRow; q: string }) {
  switch (row.kind) {
    case 'all':
      return (
        <>
          <SearchIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            All results for “<span className="font-semibold">{q}</span>”
          </span>
          <Kbd>↵</Kbd>
        </>
      );
    case 'only':
      return (
        <>
          <HashIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">
            Only in <span className="font-semibold">#{row.channelName}</span>
          </span>
          <Kbd>⇧↵</Kbd>
        </>
      );
    case 'channel':
      return (
        <>
          <HashIcon aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="min-w-0 truncate">
            <Snippet parts={markTitle(row.channel.name, q)} />
          </span>
          {row.channel.visibility === 'private' ? (
            <LockIcon aria-label="Private" className="size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          {row.channel.isArchived ? <ArchivedBadge /> : null}
        </>
      );
    case 'thread':
      return (
        <>
          <span className="min-w-0 flex-1 truncate">
            <Snippet parts={markTitle(row.thread.title, q)} />
          </span>
          <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
            {row.thread.resolvedAt ? <span>Resolved</span> : null}
            <span>#{row.thread.channelName}</span>
          </span>
        </>
      );
  }
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border bg-muted max-md:hidden px-1 font-sans text-xs text-muted-foreground">
      {children}
    </kbd>
  );
}
