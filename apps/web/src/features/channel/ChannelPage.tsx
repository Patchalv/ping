import type { ChannelView } from '@ping/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { BellIcon, BellOffIcon, ChevronLeftIcon, LockIcon, SettingsIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Badge } from '#/components/ui/badge';
import { Button } from '#/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#/components/ui/dialog';
import { FormError } from '../../components/FormError';
import { NotFound } from '../../components/NotFound';
import { ApiError } from '../../lib/api-client';
import { useChannel, useJoinChannel, useLeaveChannel, useMuteChannel } from './api';
import { ChannelSettingsDialog } from './ChannelSettingsDialog';
import { MembersTab } from './MembersTab';

type ChannelTab = 'threads' | 'members';

/**
 * The Channel view: its Channel bar above the Thread feed or the Members tab, with an
 * open Thread's panel beside them. The Thread and Section pieces come from the router,
 * because one feature never imports another: `startThread` is the + New Thread control,
 * `sectionPicker` the Section picker (shown to members), `listControls` the Thread list
 * controls in the bar, `children` the feed, and `panel`
 * the open Thread.
 */
export function ChannelPage({
  channelId,
  tab,
  startThread,
  sectionPicker,
  listControls,
  children,
  panel,
}: {
  channelId: string;
  tab: ChannelTab;
  startThread?: ReactNode;
  sectionPicker?: ReactNode;
  listControls?: ReactNode;
  children?: ReactNode;
  panel?: ReactNode;
}) {
  const channel = useChannel(channelId);
  if (channel.isPending) {
    return <p className="px-6 py-10 text-center text-muted-foreground">Loading…</p>;
  }
  if (channel.isError) {
    return channel.error instanceof ApiError && channel.error.status === 404 ? (
      <ChannelNotFound />
    ) : (
      <p className="px-6 py-10 text-center text-destructive" role="alert">
        {channel.error.message}
      </p>
    );
  }
  return (
    <div className="flex h-full min-h-0">
      <div className="min-w-0 flex-1 overflow-auto">
        <ChannelBar
          channel={channel.data}
          tab={tab}
          startThread={startThread}
          sectionPicker={sectionPicker}
          listControls={listControls}
        />
        {tab === 'members' ? (
          <MembersTab channel={channel.data} />
        ) : (
          <section className="px-4 pt-3 pb-20 md:px-5" aria-label="Threads">
            {children}
          </section>
        )}
      </div>
      {panel}
    </div>
  );
}

const TAB_CLASS =
  'border-b-2 border-transparent pb-1.5 text-small font-semibold text-muted-foreground hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:text-foreground';

function ChannelBar({
  channel,
  tab,
  startThread,
  sectionPicker,
  listControls,
}: {
  channel: ChannelView;
  tab: ChannelTab;
  startThread: ReactNode;
  sectionPicker: ReactNode;
  listControls: ReactNode;
}) {
  const isPrivate = channel.visibility === 'private';
  return (
    <section
      className="sticky top-0 z-10 border-b bg-background px-4 pt-2.5 md:px-5 md:pt-3"
      aria-label="Channel"
    >
      {/* Wraps when an open Thread's panel leaves the bar narrow. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1.5">
        {/* Phone only: the sidebar is the home screen, so the Channel view needs a way back. */}
        <Link
          className="-ml-1 inline-flex shrink-0 items-center text-sm font-semibold text-primary md:hidden"
          to="/"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-4" />
          Channels
        </Link>
        <h1 className="min-w-0 truncate text-lg font-bold">{channel.name}</h1>
        {isPrivate ? (
          <Badge variant="tag">
            <LockIcon aria-hidden="true" />
            Private
          </Badge>
        ) : null}
        <span className="ml-auto shrink-0 text-small text-muted-foreground">
          {channel.memberCount} {channel.memberCount === 1 ? 'member' : 'members'}
        </span>
        {/* Members start Threads, except in an Archived channel. Join sits in + New
            Thread's place for a Public channel you haven't joined. */}
        {channel.isMember ? (
          <>
            {channel.isArchived ? null : startThread}
            <MuteAction channel={channel} />
            {/* Settings don't change in an Archived channel. */}
            {channel.isChannelAdmin && !channel.isArchived ? (
              <SettingsAction channel={channel} />
            ) : null}
            <LeaveAction channel={channel} />
          </>
        ) : channel.isArchived ? null : (
          <JoinAction channel={channel} />
        )}
      </div>
      {channel.description ? (
        <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">
          {channel.description}
        </p>
      ) : null}
      {/* The router marks the current tab with aria-current="page". Threads matches its
          open Threads' paths too, but only exactly on the Members tab, whose path it
          would also match. */}
      <div className="mt-2 flex items-end gap-4">
        <nav className="flex gap-4" aria-label="Channel tabs">
          <Link
            to="/channels/$channelId"
            params={{ channelId: channel.id }}
            activeOptions={{ exact: tab === 'members' }}
            className={TAB_CLASS}
          >
            Threads
          </Link>
          <Link
            to="/channels/$channelId/members"
            params={{ channelId: channel.id }}
            activeOptions={{ exact: true }}
            className={TAB_CLASS}
          >
            Members
          </Link>
        </nav>
        {/* Sections hold only the Channels you're in. */}
        {channel.isMember && sectionPicker ? (
          <div className="-mt-1 mb-0.5 ml-auto min-w-0">{sectionPicker}</div>
        ) : null}
      </div>
      {tab === 'threads' ? listControls : null}
    </section>
  );
}

/** Join a Public channel you're reading. It then shows in your sidebar. */
function JoinAction({ channel }: { channel: ChannelView }) {
  const join = useJoinChannel();
  return (
    <>
      <Button
        className="shrink-0"
        disabled={join.isPending}
        onClick={() => join.mutate(channel.id)}
      >
        {join.isPending ? 'Joining…' : 'Join'}
      </Button>
      {join.isError ? <FormError className="basis-full">{join.error.message}</FormError> : null}
    </>
  );
}

/**
 * Mute or unmute the whole Channel, for members: new Thread Responses stop Pinging you.
 * New Threads and Mentions still do.
 */
function MuteAction({ channel }: { channel: ChannelView }) {
  const mute = useMuteChannel(channel.id);
  return (
    <>
      <Button
        variant="outline"
        className="shrink-0"
        aria-pressed={channel.isMuted}
        title={
          channel.isMuted
            ? 'Muted: new Thread Responses here don’t Ping you'
            : 'Stop new Thread Responses here Pinging you'
        }
        disabled={mute.isPending}
        onClick={() => mute.mutate(!channel.isMuted)}
      >
        {channel.isMuted ? <BellOffIcon aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
        {channel.isMuted ? 'Muted' : 'Mute'}
      </Button>
      {mute.isError ? <FormError className="basis-full">{mute.error.message}</FormError> : null}
    </>
  );
}

/** Channel settings, for its Channel admins. */
function SettingsAction({ channel }: { channel: ChannelView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* On a phone the bar is tight, so only the icon shows; the name stays for screen readers. */}
      <Button
        variant="outline"
        className="shrink-0 max-md:[&>span]:sr-only"
        title="Channel settings"
        onClick={() => setOpen(true)}
      >
        <SettingsIcon aria-hidden="true" />
        <span>Settings</span>
      </Button>
      {open ? <ChannelSettingsDialog channel={channel} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Leave, after asking: the server refuses the last active Channel admin, with a reason. */
function LeaveAction({ channel }: { channel: ChannelView }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button variant="outline" className="shrink-0" onClick={() => setConfirming(true)}>
        Leave…
      </Button>
      {confirming ? <LeaveDialog channel={channel} onClose={() => setConfirming(false)} /> : null}
    </>
  );
}

function LeaveDialog({ channel, onClose }: { channel: ChannelView; onClose(): void }) {
  const navigate = useNavigate();
  const isPrivate = channel.visibility === 'private';
  const leave = useLeaveChannel({
    onLeft: () => {
      onClose();
      // A Private channel is gone once you leave, so move off it.
      if (isPrivate) void navigate({ to: '/browse' });
    },
  });
  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave {channel.name}?</DialogTitle>
          <DialogDescription>
            {isPrivate
              ? 'It’s Private, so you can’t read it any more once you leave. A Channel admin has to add you back.'
              : 'It leaves your sidebar. It’s Public, so you can still read it and join again from Browse channels.'}
          </DialogDescription>
        </DialogHeader>
        {leave.isError ? <FormError>{leave.error.message}</FormError> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            disabled={leave.isPending}
            onClick={() => leave.mutate(channel)}
          >
            {leave.isPending ? 'Leaving…' : 'Leave'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A missing Channel and a Private one the Staff member isn't in look the same. */
function ChannelNotFound() {
  return (
    <NotFound
      title="Channel not found"
      note="Check the link. If it’s a Private channel, ask one of its Channel admins to add you."
    />
  );
}
