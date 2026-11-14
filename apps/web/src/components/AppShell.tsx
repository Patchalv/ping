// The signed-in app: dark top bar, dark sidebar, and the main area (screens.md › Laptop).
// On a phone the sidebar is the home screen, and opening a Channel replaces it.
import type { SidebarChannel } from '@ping/shared';
import { useState } from 'react';
import { useMyChannels } from '../features/channel/api';
import { ChannelNotFound, ChannelPage } from '../features/channel/ChannelPage';
import { CreateChannelDialog } from '../features/channel/CreateChannelDialog';
import type { Resource } from '../lib/api-error';
import { channelPath, navigate, useRoute } from '../lib/router';
import { AvatarMenu } from './AvatarMenu';
import { HashIcon, LockIcon, PlusIcon, SearchIcon } from './icons';

type User = { name: string; email: string };

export function AppShell({ user }: { user: User }) {
  const route = useRoute();
  const [channels, reloadChannels] = useMyChannels();
  const [creating, setCreating] = useState(false);
  const activeId = route.name === 'channel' ? route.channelId : null;

  return (
    <div className="shell" data-view={route.name === 'home' ? 'home' : 'main'}>
      <header className="top-bar">
        <span className="top-bar__brand">Ping</span>
        <div className="top-bar__search">
          <SearchIcon className="top-bar__search-icon" />
          <input
            className="top-bar__search-input"
            type="search"
            placeholder="Search arrives in a later release"
            aria-label="Search"
            disabled
          />
        </div>
        <AvatarMenu user={user} />
      </header>

      <Sidebar channels={channels} activeId={activeId} onCreate={() => setCreating(true)} />

      <main className="shell__main">
        {route.name === 'channel' && (
          <ChannelPage key={route.channelId} channelId={route.channelId} />
        )}
        {route.name === 'home' && (
          <p className="main-note">Pick a Channel from the sidebar, or create one.</p>
        )}
        {route.name === 'notFound' && <ChannelNotFound />}
      </main>

      {creating && (
        <CreateChannelDialog
          onClose={() => setCreating(false)}
          onCreated={(channel) => {
            setCreating(false);
            reloadChannels();
            navigate(channelPath(channel.id));
          }}
        />
      )}
    </div>
  );
}

function Sidebar({
  channels,
  activeId,
  onCreate,
}: {
  channels: Resource<SidebarChannel[]>;
  activeId: string | null;
  onCreate(): void;
}) {
  return (
    <nav className="sidebar" aria-label="Channels">
      <h2 className="sidebar__heading">Channels</h2>
      {channels.status === 'ready' && channels.data.length === 0 && (
        <p className="sidebar__empty">You’re not in any Channels yet.</p>
      )}
      {channels.status === 'error' && (
        <p className="sidebar__empty" role="alert">
          {channels.message}
        </p>
      )}
      {channels.status === 'ready' && (
        <ul className="sidebar__list">
          {channels.data.map((channel) => (
            <li key={channel.id}>
              <ChannelLink channel={channel} active={channel.id === activeId} />
            </li>
          ))}
        </ul>
      )}
      <div className="sidebar__rule" />
      <button className="sidebar__item sidebar__action" type="button" onClick={onCreate}>
        <PlusIcon className="sidebar__icon" />
        Create channel
      </button>
    </nav>
  );
}

function ChannelLink({ channel, active }: { channel: SidebarChannel; active: boolean }) {
  const href = channelPath(channel.id);
  const isPrivate = channel.visibility === 'private';
  return (
    <a
      className="sidebar__item"
      href={href}
      aria-current={active ? 'page' : undefined}
      // The lock icon is decorative, so the name says Private for screen readers.
      aria-label={isPrivate ? `${channel.name}, Private` : undefined}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        navigate(href);
      }}
    >
      {isPrivate ? <LockIcon className="sidebar__icon" /> : <HashIcon className="sidebar__icon" />}
      <span className="sidebar__name">{channel.name}</span>
    </a>
  );
}
