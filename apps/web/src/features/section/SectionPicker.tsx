// The Section picker in the Channel bar: which of the Staff member's Sections the Channel
// sits in. The only way to move a Channel on a phone, and the keyboard's way on a laptop
// (screens.md › Channel view, › Phone). Shown to the Channel's members only.
import { ListTreeIcon } from 'lucide-react';
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
import { usePlaceChannel, useSections } from './api';

/** The radio value for the default Channels section. */
const DEFAULT_SECTION = 'default';

export function SectionPicker({ channelId }: { channelId: string }) {
  const sections = useSections();
  const place = usePlaceChannel();
  const current = sections.data?.find((s) => s.channelIds.includes(channelId));
  const currentName = current?.name ?? 'Channels';

  return (
    <div className="flex min-w-0 items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="sm" />}
          className="min-w-0 text-muted-foreground"
          aria-label={`Section: ${currentName}`}
          disabled={!sections.data}
        >
          <ListTreeIcon aria-hidden="true" />
          <span className="truncate">{currentName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Show in your sidebar under</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={current?.id ?? DEFAULT_SECTION}
              onValueChange={(value: unknown) => {
                if (typeof value !== 'string') return;
                place.mutate({
                  channelId,
                  sectionId: value === DEFAULT_SECTION ? null : value,
                });
              }}
            >
              {sections.data?.map((s) => (
                <DropdownMenuRadioItem key={s.id} value={s.id} closeOnClick>
                  <span className="truncate">{s.name}</span>
                </DropdownMenuRadioItem>
              ))}
              <DropdownMenuRadioItem value={DEFAULT_SECTION} closeOnClick>
                Channels
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            {sections.data?.length === 0 ? (
              <DropdownMenuLabel className="font-normal">
                Make your own with New section in the sidebar.
              </DropdownMenuLabel>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {place.isError ? (
        <span className="text-small text-destructive" role="alert">
          {place.error.message}
        </span>
      ) : null}
    </div>
  );
}
