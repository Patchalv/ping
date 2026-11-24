// The search chips (screens.md › Search): In: #channel, suggested when search was opened
// from a Channel and never applied by default; From: person, Deactivated people included;
// and Status, All by default.
import type { SearchRouteSearch, SearchStatus } from '@ping/shared';
import { ChevronDownIcon, PlusIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '#/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import { useChipChannel, useSearchPeople } from './api';

const STATUS_LABEL: Record<SearchStatus, string> = {
  all: 'All',
  open: 'Open',
  resolved: 'Resolved',
};

/** The radio value for "anyone" in the From chip. */
const ANYONE = 'anyone';

export function SearchChips({
  search,
  onChange,
}: {
  search: SearchRouteSearch;
  onChange(next: Partial<SearchRouteSearch>): void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <legend className="sr-only">Filters</legend>
      {search.in ? (
        <InChip channelId={search.in} onRemove={() => onChange({ in: undefined })} />
      ) : search.near ? (
        <InSuggestion channelId={search.near} onApply={() => onChange({ in: search.near })} />
      ) : null}
      <FromChip from={search.from} onChange={(from) => onChange({ from })} />
      <ChoiceMenu label="Status" summary={STATUS_LABEL[search.status]}>
        <DropdownMenuRadioGroup
          value={search.status}
          onValueChange={(status: SearchStatus) => onChange({ status })}
        >
          {(Object.keys(STATUS_LABEL) as SearchStatus[]).map((status) => (
            <DropdownMenuRadioItem key={status} value={status}>
              {STATUS_LABEL[status]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </ChoiceMenu>
    </fieldset>
  );
}

/** The applied In chip: clicking it removes it. */
function InChip({ channelId, onRemove }: { channelId: string; onRemove(): void }) {
  const channel = useChipChannel(channelId);
  const name = channel.data?.name ?? '…';
  return (
    <Button variant="outline" size="sm" aria-label={`Remove In: #${name}`} onClick={onRemove}>
      <span className="text-muted-foreground">In:</span>#{name}
      <XIcon aria-hidden="true" />
    </Button>
  );
}

/** The one-click suggestion to search only the Channel search was opened from. */
function InSuggestion({ channelId, onApply }: { channelId: string; onApply(): void }) {
  const channel = useChipChannel(channelId);
  // A Channel that can't be read offers nothing.
  if (!channel.data) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="border border-dashed"
      aria-label={`Search only in #${channel.data.name}`}
      onClick={onApply}
    >
      <PlusIcon aria-hidden="true" />
      <span className="text-muted-foreground">In:</span>#{channel.data.name}
    </Button>
  );
}

function FromChip({
  from,
  onChange,
}: {
  from: string | undefined;
  onChange(from: string | undefined): void;
}) {
  const people = useSearchPeople();
  const list = people.data?.people ?? [];
  const chosen = list.find((person) => person.staffId === from);
  return (
    <ChoiceMenu label="From" summary={from ? (chosen?.name ?? '…') : 'Anyone'}>
      <DropdownMenuRadioGroup
        value={from ?? ANYONE}
        onValueChange={(value: string) => onChange(value === ANYONE ? undefined : value)}
      >
        <DropdownMenuRadioItem value={ANYONE}>Anyone</DropdownMenuRadioItem>
        {list.map((person) => (
          <DropdownMenuRadioItem key={person.staffId} value={person.staffId}>
            <span className="truncate">{person.name}</span>
            {person.isDeactivated ? (
              <span className="text-xs text-muted-foreground">Deactivated</span>
            ) : null}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>
      {people.isError ? (
        <p className="px-2 py-1.5 text-sm text-destructive" role="alert">
          {people.error.message}
        </p>
      ) : null}
    </ChoiceMenu>
  );
}

/** One chip: a small button naming the choice, opening its options. */
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
        <span className="max-w-40 truncate">{summary}</span>
        <ChevronDownIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{label}</DropdownMenuLabel>
        </DropdownMenuGroup>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
