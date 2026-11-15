// The signed-in app, as the router's root: dark top bar, dark sidebar, and the current
// route in the main area (screens.md › Laptop). On a phone the sidebar is the home
// screen, and any other route replaces it.
import type { SidebarChannel } from '@ping/shared';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { useState } from 'react';
import { useMyChannels } from '../features/channel/api';
import { CreateChannelDialog } from '../features/channel/CreateChannelDialog';
import { authClient } from '../lib/auth-client';
import { AvatarMenu } from './AvatarMenu';
import { HashIcon, LockIcon, PlusIcon, SearchIcon } from './icons';

export function AppShell() {
  const { data: session } = authClient.useSession();
  const navigate = useNavigate();
  const isHome = useRouterState({ select: (state) => state.location.pathname === '/' });
  const [creating, setCreating] = useState(false);

  return (
    <div className="shell" data-view={isHome ? 'home' : 'main'}>
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
        <button
          className="top-bar__search-button"
          type="button"
          aria-label="Search"
          title="Search arrives in a later release"
          disabled
        >
          <SearchIcon />
        </button>
        {session ? <AvatarMenu user={session.user} /> : null}
      </header>

      <Sidebar onCreate={() => setCreating(true)} />

      <main className="shell__main">
        <Outlet />
      </main>

      {creating ? (
        <CreateChannelDialog
          onClose={() => setCreating(false)}
          onCreated={(channel) => {
            setCreating(false);
            void navigate({ to: '/channels/$channelId', params: { channelId: channel.id } });
          }}
        />
      ) : null}
    </div>
  );
}

/** The home route's main area. On a phone it's hidden: the sidebar is home. */
export function HomeNote() {
  return <p className="main-note">Pick a Channel from the sidebar, or create one.</p>;
}

function Sidebar({ onCreate }: { onCreate(): void }) {
  const channels = useMyChannels();
  return (
    <nav className="sidebar" aria-label="Channels">
      <h2 className="sidebar__heading">Channels</h2>
      {channels.isError ? (
        <p className="sidebar__empty" role="alert">
          {channels.error.message}
        </p>
      ) : channels.data?.length === 0 ? (
        <p className="sidebar__empty">You’re not in any Channels yet.</p>
      ) : channels.data ? (
        <ul className="sidebar__list">
          {channels.data.map((channel) => (
            <li key={channel.id}>
              <ChannelLink channel={channel} />
            </li>
          ))}
        </ul>
      ) : null}
      <div className="sidebar__rule" />
      <button className="sidebar__item sidebar__action" type="button" onClick={onCreate}>
        <PlusIcon className="sidebar__icon" />
        Create channel
      </button>
    </nav>
  );
}

function ChannelLink({ channel }: { channel: SidebarChannel }) {
  const isPrivate = channel.visibility === 'private';
  return (
    <Link
      className="sidebar__item"
      to="/channels/$channelId"
      params={{ channelId: channel.id }}
      activeProps={{ 'aria-current': 'page' }}
      // The lock icon is decorative, so the name says Private for screen readers.
      aria-label={isPrivate ? `${channel.name}, Private` : undefined}
    >
      {isPrivate ? <LockIcon className="sidebar__icon" /> : <HashIcon className="sidebar__icon" />}
      <span className="sidebar__name">{channel.name}</span>
    </Link>
  );
}
