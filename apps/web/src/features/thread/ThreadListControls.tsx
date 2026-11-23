import type { ThreadListView } from '@ping/shared';
import { ChevronDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '#/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { useThreads } from './api';

const STATUS_LABEL: Record<ThreadListView['status'], string> = {
  open: 'Open',
  resolved: 'Resolved',
  all: 'All',
};
const PINGS_LABEL: Record<ThreadListView['pings'], string> = {
  all: 'All',
  with: 'With Pings',
};
const SORT_LABEL: Record<ThreadListView['sort'], string> = {
  latest_activity: 'Latest activity',
  date_started: 'Date started',
};
const DIRECTION_LABEL: Record<ThreadListView['direction'], string> = {
  desc: 'Newest first',
  asc: 'Oldest first',
};

/**
 * The Thread list controls in the Channel bar (screens.md › Channel view): Status, Pings,
 * and sort with direction, plus an "N Resolved hidden" note while Status is Open.
 */
export function ThreadListControls({
  channelId,
  view,
  onChange,
}: {
  channelId: string;
  view: ThreadListView;
  onChange(next: Partial<ThreadListView>): void;
}) {
  // The same query as the feed below, so this reads its cached page.
  const threads = useThreads(channelId, view);
  const hidden = threads.data?.pages[0]?.resolvedHidden ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-2">
      <ChoiceMenu label="Status" summary={STATUS_LABEL[view.status]}>
        <DropdownMenuRadioGroup
          value={view.status}
          onValueChange={(status: ThreadListView['status']) => onChange({ status })}
        >
          {(['open', 'resolved', 'all'] as const).map((status) => (
            <DropdownMenuRadioItem key={status} value={status}>
              {STATUS_LABEL[status]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </ChoiceMenu>
      <ChoiceMenu label="Pings" summary={PINGS_LABEL[view.pings]}>
        <DropdownMenuRadioGroup
          value={view.pings}
          onValueChange={(pings: ThreadListView['pings']) => onChange({ pings })}
        >
          <DropdownMenuRadioItem value="all">All</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="with">With Pings</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </ChoiceMenu>
      <ChoiceMenu
        label="Sort"
        summary={`${SORT_LABEL[view.sort]}, ${DIRECTION_LABEL[view.direction].toLowerCase()}`}
      >
        <DropdownMenuRadioGroup
          value={view.sort}
          onValueChange={(sort: ThreadListView['sort']) => onChange({ sort })}
        >
          <DropdownMenuRadioItem value="latest_activity">Latest activity</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="date_started">Date started</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={view.direction}
          onValueChange={(direction: ThreadListView['direction']) => onChange({ direction })}
        >
          <DropdownMenuRadioItem value="desc">Newest first</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="asc">Oldest first</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </ChoiceMenu>
      {view.status === 'open' && hidden > 0 ? (
        <p className="text-small text-muted-foreground">{hidden} Resolved hidden</p>
      ) : null}
    </div>
  );
}

/** One control: a small button naming the choice, opening its options. */
function ChoiceMenu({
  label,
  summary,
  children,
}: {
  label: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        <span className="text-muted-foreground">{label}:</span>
        {summary}
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
