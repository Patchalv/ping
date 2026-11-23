import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { BellIcon, CompassIcon, PlusIcon, SearchIcon, UserPenIcon, UsersIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Button } from '#/components/ui/button';
import { DropdownMenuItem, DropdownMenuLinkItem } from '#/components/ui/dropdown-menu';
import { Input } from '#/components/ui/input';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
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
import { NewSectionButton, SidebarSections } from '../features/section/SidebarSections';
import { useCurrentStaffMember } from '../features/staff/api';
import { ProfileDialog } from '../features/staff/ProfileDialog';
import { usePingSummary } from '../features/thread/api';
import { authClient } from '../lib/auth-client';
import { AvatarMenu } from './AvatarMenu';
import { EnvironmentBadge } from './EnvironmentBadge';
import { PingMark } from './PingMark';

export function AppShell() {
  const { data: session, refetch: refetchSession } = authClient.useSession();
  // Only to hide the Admin screens' link; the server decides who may use them.
  const me = useCurrentStaffMember();
  const navigate = useNavigate();
  const isHome = useRouterState({ select: (state) => state.location.pathname === '/' });
  const [creating, setCreating] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  return (
    // One column, held to the viewport: a wide Thread panel shrinks the feed beside it
    // instead of pushing the page past the window's edge.
    <SidebarProvider className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)] bg-chrome">
      <TopBar>
        {session ? (
          <AvatarMenu user={session.user}>
            <DropdownMenuItem onClick={() => setEditingProfile(true)}>
              <UserPenIcon aria-hidden="true" />
              Edit profile
            </DropdownMenuItem>
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
      {editingProfile && session ? (
        <ProfileDialog
          me={session.user}
          onNameChanged={() => void refetchSession()}
          onClose={() => setEditingProfile(false)}
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
      <span className="flex items-center gap-1.5 px-1 text-lg font-bold tracking-tight">
        <PingMark className="size-6" />
        Ping
        <EnvironmentBadge />
      </span>
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
  const summary = usePingSummary();
  const countIn = (channelId: string) =>
    summary.data?.channels.find((c) => c.channelId === channelId)?.count ?? 0;
  return (
    <nav aria-label="Channels" className="flex min-h-0 flex-1 flex-col">
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link to="/pings" activeProps={{ 'aria-current': 'page' }} />}
              >
                <BellIcon aria-hidden="true" />
                <span>Pings</span>
                {summary.data && summary.data.threadCount > 0 ? (
                  <span className="ml-auto rounded-full bg-ping px-1.5 text-xs font-semibold text-white">
                    {summary.data.threadCount}
                    <span className="sr-only"> Threads with Pings</span>
                  </span>
                ) : null}
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
        <SidebarSeparator />
        {/* The Staff member's own Sections, then the default Channels section. */}
        {channels.isError ? (
          <p className="px-4 py-1 text-sm text-sidebar-muted-foreground" role="alert">
            {channels.error.message}
          </p>
        ) : channels.data ? (
          <SidebarSections channels={channels.data} pingCountIn={countIn} />
        ) : null}
        <SidebarSeparator />
        <SidebarGroup>
          <SidebarMenu>
            <SidebarMenuItem>
              <NewSectionButton />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="text-sidebar-muted-foreground"
                render={<Link to="/browse" activeProps={{ 'aria-current': 'page' }} />}
              >
                <CompassIcon aria-hidden="true" />
                <span>Browse channels</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
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
