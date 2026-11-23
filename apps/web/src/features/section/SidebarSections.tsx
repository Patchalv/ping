// The sidebar's Channels, in the Staff member's own Sections and then the default Channels
// section (screens.md › Sidebar). On a laptop, Channels move between Sections by drag and
// drop, and Sections reorder the same way; each Section's menu also moves it up and down,
// and the Section picker in the Channel bar moves Channels from the keyboard or a phone.
import type { SectionView, SidebarChannel } from '@ping/shared';
import { Link } from '@tanstack/react-router';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronRightIcon,
  HashIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { type ComponentProps, type DragEvent, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '#/components/ui/sidebar';
import { cn } from '#/lib/utils';
import { useCollapseSection, usePlaceChannel, useReorderSections } from './api';
import { DeleteSectionDialog, NewSectionDialog, RenameSectionDialog } from './SectionDialogs';
import { groupChannels, moveSection, shownChannels } from './sidebar-sections';

/** What is being dragged: a Channel, or a Section by its label. */
type Dragging = { kind: 'channel'; channelId: string } | { kind: 'section'; sectionId: string };

/** Where a drop would land, to mark it: a Channel row, or a whole group by its key. */
type DropTarget = { group: string; beforeChannelId?: string } | null;

const DEFAULT_GROUP = 'default';

type Props = {
  channels: SidebarChannel[];
  /** The Staff member's Sections, loaded by ChannelNav beside the Channels, or none. */
  sections: SectionView[] | undefined;
  sectionsError: Error | null;
  pingCountIn(channelId: string): number;
};

export function SidebarSections({ channels, sections, sectionsError, pingCountIn }: Props) {
  const place = usePlaceChannel();
  const reorder = useReorderSections();
  const collapse = useCollapseSection();
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);
  const [renaming, setRenaming] = useState<SectionView | null>(null);
  const [deleting, setDeleting] = useState<SectionView | null>(null);

  const groups = groupChannels(channels, sections);
  const sectionIds = groups.sections.map((g) => g.section.id);
  const failure = place.error ?? reorder.error ?? collapse.error ?? sectionsError;

  const endDrag = () => {
    setDragging(null);
    setDropTarget(null);
  };

  /** Drag handlers for a place a Channel can drop: a group's end, or before a row. */
  const channelDrop = (sectionId: string | null, group: string, before?: SidebarChannel) => ({
    onDragOver: (event: DragEvent) => {
      if (dragging?.kind !== 'channel') return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget({ group, beforeChannelId: before?.id });
    },
    onDrop: (event: DragEvent) => {
      if (dragging?.kind !== 'channel') return;
      event.preventDefault();
      event.stopPropagation();
      const { channelId } = dragging;
      endDrag();
      if (channelId === before?.id) return;
      if (sectionId === null) {
        place.mutate({ channelId, sectionId: null });
        return;
      }
      const order = groups.sections
        .find((g) => g.section.id === sectionId)
        ?.section.channelIds.filter((id) => id !== channelId);
      const index = before && order ? order.indexOf(before.id) : -1;
      place.mutate({ channelId, sectionId, ...(index >= 0 ? { position: index } : {}) });
    },
  });

  /** Drag handlers for a Section label another Section can drop before. */
  const sectionDrop = (sectionId: string) => ({
    onDragOver: (event: DragEvent) => {
      if (dragging?.kind !== 'section') return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDropTarget({ group: sectionId });
    },
    onDrop: (event: DragEvent) => {
      if (dragging?.kind !== 'section') return;
      event.preventDefault();
      const moving = dragging.sectionId;
      endDrag();
      if (moving === sectionId) return;
      reorder.mutate(moveSection(sectionIds, moving, { before: sectionId }));
    },
  });

  const channelRows = (list: SidebarChannel[], sectionId: string | null, group: string) =>
    list.map((channel) => (
      <SidebarMenuItem
        key={channel.id}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', channel.name);
          setDragging({ kind: 'channel', channelId: channel.id });
        }}
        onDragEnd={endDrag}
        className={cn(
          'rounded-md',
          dropTarget?.group === group &&
            dropTarget.beforeChannelId === channel.id &&
            "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-sidebar-ring before:content-['']",
        )}
        {...channelDrop(sectionId, group, channel)}
      >
        <ChannelLink channel={channel} pingCount={pingCountIn(channel.id)} />
      </SidebarMenuItem>
    ));

  const isGroupTarget = (group: string) =>
    dropTarget?.group === group && dropTarget.beforeChannelId === undefined;

  return (
    <>
      {failure ? (
        <p className="px-4 py-1 text-sm text-sidebar-muted-foreground" role="alert">
          {failure.message}
        </p>
      ) : null}

      {groups.sections.map(({ section, channels: inSection }, index) => {
        const shown = shownChannels(inSection, section.collapsed, pingCountIn);
        return (
          <SidebarGroup
            key={section.id}
            aria-label={section.name}
            role="group"
            className={cn('rounded-md', isGroupTarget(section.id) && 'bg-sidebar-accent/60')}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                setDropTarget(null);
              }
            }}
            {...channelDrop(section.id, section.id)}
          >
            <SidebarGroupLabel
              render={(props: ComponentProps<'h2'>) => <h2 {...props} />}
              className="pr-8"
              draggable
              onDragStart={(event: DragEvent) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', section.name);
                setDragging({ kind: 'section', sectionId: section.id });
              }}
              onDragEnd={endDrag}
              {...sectionDrop(section.id)}
            >
              <button
                type="button"
                className="-mx-2 flex h-full min-w-0 flex-1 items-center gap-1 rounded-md px-2 outline-hidden hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring"
                aria-expanded={!section.collapsed}
                onClick={() =>
                  collapse.mutate({ sectionId: section.id, collapsed: !section.collapsed })
                }
              >
                <ChevronRightIcon
                  aria-hidden="true"
                  className={cn('size-3.5 transition-transform', !section.collapsed && 'rotate-90')}
                />
                <span className="truncate">{section.name}</span>
              </button>
            </SidebarGroupLabel>
            <SectionMenu
              section={section}
              isFirst={index === 0}
              isLast={index === groups.sections.length - 1}
              onMove={(delta) => reorder.mutate(moveSection(sectionIds, section.id, delta))}
              onRename={() => setRenaming(section)}
              onDelete={() => setDeleting(section)}
            />
            {shown.length > 0 ? (
              <SidebarMenu>{channelRows(shown, section.id, section.id)}</SidebarMenu>
            ) : section.collapsed ? null : (
              <p className="px-2 py-1 text-small text-sidebar-muted-foreground">
                <span className="max-md:hidden">Drag Channels here, or use</span>
                <span className="md:hidden">Add Channels with</span> the Section picker in a
                Channel.
              </p>
            )}
          </SidebarGroup>
        );
      })}

      <SidebarGroup
        aria-label="Channels"
        role="group"
        className={cn('rounded-md', isGroupTarget(DEFAULT_GROUP) && 'bg-sidebar-accent/60')}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDropTarget(null);
          }
        }}
        {...channelDrop(null, DEFAULT_GROUP)}
      >
        <SidebarGroupLabel render={(props: ComponentProps<'h2'>) => <h2 {...props} />}>
          Channels
        </SidebarGroupLabel>
        {channels.length === 0 ? (
          <p className="px-2 py-1 text-sm text-sidebar-muted-foreground">
            You’re not in any Channels yet.
          </p>
        ) : groups.unplaced.length === 0 ? (
          <p className="px-2 py-1 text-small text-sidebar-muted-foreground">
            Every Channel is in a Section. Drag one here to take it out.
          </p>
        ) : (
          <SidebarMenu>{channelRows(groups.unplaced, null, DEFAULT_GROUP)}</SidebarMenu>
        )}
      </SidebarGroup>

      {renaming ? (
        <RenameSectionDialog section={renaming} onClose={() => setRenaming(null)} />
      ) : null}
      {deleting ? (
        <DeleteSectionDialog section={deleting} onClose={() => setDeleting(null)} />
      ) : null}
    </>
  );
}

/** A Section's menu: rename, move up or down, delete. */
function SectionMenu({
  section,
  isFirst,
  isLast,
  onMove,
  onRename,
  onDelete,
}: {
  section: SectionView;
  isFirst: boolean;
  isLast: boolean;
  onMove(delta: -1 | 1): void;
  onRename(): void;
  onDelete(): void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<SidebarGroupAction />}
        aria-label={`${section.name} options`}
        className="max-md:size-9"
      >
        <MoreHorizontalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={onRename}>
          <PencilIcon aria-hidden="true" />
          Rename…
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isFirst} onClick={() => onMove(-1)}>
          <ArrowUpIcon aria-hidden="true" />
          Move up
        </DropdownMenuItem>
        <DropdownMenuItem disabled={isLast} onClick={() => onMove(1)}>
          <ArrowDownIcon aria-hidden="true" />
          Move down
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2Icon aria-hidden="true" />
          Delete…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** + New section, beside Browse channels and Create channel. */
export function NewSectionButton() {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <SidebarMenuButton
        className="text-sidebar-muted-foreground"
        onClick={() => setCreating(true)}
      >
        <PlusIcon aria-hidden="true" />
        <span>New section</span>
      </SidebarMenuButton>
      {creating ? <NewSectionDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function ChannelLink({ channel, pingCount }: { channel: SidebarChannel; pingCount: number }) {
  const isPrivate = channel.visibility === 'private';
  return (
    <SidebarMenuButton
      render={
        <Link
          to="/channels/$channelId"
          params={{ channelId: channel.id }}
          activeProps={{ 'aria-current': 'page' }}
          // The lock icon is decorative, so the name says Private for screen readers.
          aria-label={isPrivate ? `${channel.name}, Private` : undefined}
          draggable={false}
        />
      }
    >
      {isPrivate ? <LockIcon aria-hidden="true" /> : <HashIcon aria-hidden="true" />}
      <span className={pingCount > 0 ? 'font-bold' : undefined}>{channel.name}</span>
      {pingCount > 0 ? (
        // A muted Channel's count is grey: it still counts, but asks for less.
        <span
          className={cn(
            'ml-auto text-xs font-semibold',
            channel.isMuted && 'font-normal text-sidebar-muted-foreground',
          )}
        >
          {pingCount}
          <span className="sr-only">
            {channel.isMuted ? ' Threads with Pings, muted' : ' Threads with Pings'}
          </span>
        </span>
      ) : null}
    </SidebarMenuButton>
  );
}
