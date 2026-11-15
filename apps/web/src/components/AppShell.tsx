// The signed-in app, as the router's root: dark top bar, dark sidebar, and the current
// route in an inset panel (screens.md › Laptop). On a phone the sidebar is the home
// screen, and any other route replaces it.
import type { SidebarChannel } from '@ping/shared';
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { HashIcon, LockIcon, PlusIcon, SearchIcon, UsersIcon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useState } from 'react';
import { Button } from '#/components/ui/button';
import { DropdownMenuLinkItem } from '#/components/ui/dropdown-menu';
import { Input } from '#/components/ui/input';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarResizeHandle,
  SidebarSeparator,
  SidebarTrigger,
} from '#/components/ui/sidebar';
import { useMyChannels } from '../features/channel/api';
import { CreateChannelDialog } from '../features/channel/CreateChannelDialog';
import { useCurrentStaffMember } from '../features/staff/api';
import { authClient } from '../lib/auth-client';
import { AvatarMenu } from './AvatarMenu';

export function AppShell() {
  const { data: session } = authClient.useSession();
  // Only to hide the Admin screens' link; the server decides who may use them.
  const me = useCurrentStaffMember();
  const navigate = useNavigate();
  const isHome = useRouterState({ select: (state) => state.location.pathname === '/' });
  const [creating, setCreating] = useState(false);

  return (
    <SidebarProvider className="grid h-dvh grid-rows-[auto_minmax(0,1fr)] bg-chrome">
      <TopBar>
        {session ? (
          <AvatarMenu user={session.user}>
            {me.data?.role === 'admin' ? (
              <DropdownMenuLinkItem render={<Link to="/staff" />}>
                <UsersIcon aria-hidden="true" />
                Staff members
              </DropdownMenuLinkItem>
            ) : null}
          </AvatarMenu>
        ) : null}
      </TopBar>

      <div className="flex min-h-0">
        <Sidebar className={isHome ? undefined : 'max-md:hidden'}>
          <ChannelNav onCreate={() => setCreating(true)} />
          <SidebarResizeHandle />
        </Sidebar>
        <SidebarInset className={isHome ? 'max-md:hidden' : undefined}>
          <Outlet />
        </SidebarInset>
      </div>

      {creating ? (
        <CreateChannelDialog
          onClose={() => setCreating(false)}
          onCreated={(channel) => {
            setCreating(false);
            void navigate({ to: '/channels/$channelId', params: { channelId: channel.id } });
          }}
        />
      ) : null}
    </SidebarProvider>
  );
}

/** The dark bar across the top: sidebar toggle, name, search and the avatar. */
function TopBar({ children }: { children: ReactNode }) {
  return (
    <header className="flex h-11 items-center gap-2 px-2 text-chrome-foreground md:px-3">
      <SidebarTrigger />
      <span className="px-1 text-lg font-bold tracking-tight">Ping</span>
      <div className="relative mx-auto w-full max-w-xl max-md:hidden">
        <SearchIcon
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-2.5 z-10 size-4 -translate-y-1/2 text-chrome-foreground/70"
        />
        <Input
          className="h-7 border-chrome-foreground/15 bg-chrome-foreground/10 pl-8 text-chrome-foreground shadow-none placeholder:text-chrome-foreground/70 disabled:opacity-100"
          type="search"
          placeholder="Search arrives in a later release"
          aria-label="Search"
          disabled
        />
      </div>
      {/* Search sits behind an icon on a phone (screens.md › Phone). */}
      <Button
        variant="chrome"
        size="icon-sm"
        className="ml-auto md:hidden"
        aria-label="Search"
        title="Search arrives in a later release"
        disabled
      >
        <SearchIcon />
      </Button>
      {children}
    </header>
  );
}

/** The home route's main area. On a phone it's hidden: the sidebar is home. */
export function HomeNote() {
  return (
    <p className="px-6 py-10 text-center text-muted-foreground">
      Pick a Channel from the sidebar, or create one.
    </p>
  );
}

function ChannelNav({ onCreate }: { onCreate(): void }) {
  const channels = useMyChannels();
  return (
    <nav aria-label="Channels" className="flex min-h-0 flex-1 flex-col">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel render={(props: ComponentProps<'h2'>) => <h2 {...props} />}>
            Channels
          </SidebarGroupLabel>
          {channels.isError ? (
            <p className="px-2 py-1 text-sm text-sidebar-muted-foreground" role="alert">
              {channels.error.message}
            </p>
          ) : channels.data?.length === 0 ? (
            <p className="px-2 py-1 text-sm text-sidebar-muted-foreground">
              You’re not in any Channels yet.
            </p>
          ) : channels.data ? (
            <SidebarMenu>
              {channels.data.map((channel) => (
                <SidebarMenuItem key={channel.id}>
                  <ChannelLink channel={channel} />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : null}
        </SidebarGroup>
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="text-sidebar-muted-foreground" onClick={onCreate}>
                <PlusIcon aria-hidden="true" />
                <span>Create channel</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </nav>
  );
}

function ChannelLink({ channel }: { channel: SidebarChannel }) {
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
        />
      }
    >
      {isPrivate ? <LockIcon aria-hidden="true" /> : <HashIcon aria-hidden="true" />}
      <span>{channel.name}</span>
    </SidebarMenuButton>
  );
}
