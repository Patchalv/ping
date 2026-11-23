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
        <RadioChoices
          labels={STATUS_LABEL}
          value={view.status}
          onChange={(status) => onChange({ status })}
        />
      </ChoiceMenu>
      <ChoiceMenu label="Pings" summary={PINGS_LABEL[view.pings]}>
        <RadioChoices
          labels={PINGS_LABEL}
          value={view.pings}
          onChange={(pings) => onChange({ pings })}
        />
      </ChoiceMenu>
      <ChoiceMenu
        label="Sort"
        summary={`${SORT_LABEL[view.sort]}, ${DIRECTION_LABEL[view.direction].toLowerCase()}`}
      >
        <RadioChoices
          labels={SORT_LABEL}
          value={view.sort}
          onChange={(sort) => onChange({ sort })}
        />
        <DropdownMenuSeparator />
        <RadioChoices
          labels={DIRECTION_LABEL}
          value={view.direction}
          onChange={(direction) => onChange({ direction })}
        />
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

/** One choice's options, from its labels, with the current one checked. */
function RadioChoices<T extends string>({
  labels,
  value,
  onChange,
}: {
  labels: Record<T, string>;
  value: T;
  onChange(next: T): void;
}) {
  return (
    <DropdownMenuRadioGroup value={value} onValueChange={(next: T) => onChange(next)}>
      {(Object.keys(labels) as T[]).map((option) => (
        <DropdownMenuRadioItem key={option} value={option}>
          {labels[option]}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  );
}
