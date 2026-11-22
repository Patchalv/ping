// The SPA's routes: TanStack Router, code-based (ADR 0006). Navigation state lives in the
// URL. Params and search params are validated with the zod schemas in packages/shared; a
// path that fails them is not found. The server answers every non-API path with
// index.html, so a deep link loads the app and lands here.
import { channelParams } from '@ping/shared';
import {
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  type RouterHistory,
} from '@tanstack/react-router';
import { AppShell, HomeNote } from './components/AppShell';
import { PageNotFound } from './components/NotFound';
import { BrowseChannelsPage } from './features/channel/BrowseChannelsPage';
import { ChannelPage } from './features/channel/ChannelPage';
import { StaffMembersPage } from './features/staff/StaffMembersPage';

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: PageNotFound });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeNote,
});

/** A Channel ID that fails the schema is not found. */
const channelRouteParams = {
  parse: (raw: Record<string, string>) => {
    const parsed = channelParams.safeParse(raw);
    if (!parsed.success) throw notFound();
    return parsed.data;
  },
  stringify: (params: { channelId: string }) => params,
};

// The Channel view, on its Threads tab.
const channelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/channels/$channelId',
  params: channelRouteParams,
  component: ChannelRoute,
});

function ChannelRoute() {
  const { channelId } = channelRoute.useParams();
  return <ChannelPage key={channelId} channelId={channelId} tab="threads" />;
}

// The same Channel view, on its Members tab.
const channelMembersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/channels/$channelId/members',
  params: channelRouteParams,
  component: ChannelMembersRoute,
});

function ChannelMembersRoute() {
  const { channelId } = channelMembersRoute.useParams();
  return <ChannelPage key={channelId} channelId={channelId} tab="members" />;
}

// Browse channels: every Public channel, to join. Accepting an invite lands here.
const browseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/browse',
  component: BrowseChannelsPage,
});

// The Admins' Staff members screen, from the avatar menu. A Member who opens it gets the
// server's refusal.
const staffRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/staff',
  component: StaffMembersPage,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  browseRoute,
  channelRoute,
  channelMembersRoute,
  staffRoute,
]);

/** The browser's router by default; tests pass a memory history. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, trailingSlash: 'preserve', ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
