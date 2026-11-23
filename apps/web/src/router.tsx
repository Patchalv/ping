// The SPA's routes: TanStack Router, code-based (ADR 0006). Navigation state lives in the
// URL. Params and search params are validated with the zod schemas in packages/shared; a
// path that fails them is not found. The server answers every non-API path with
// index.html, so a deep link loads the app and lands here.
import { channelParams, threadParams } from '@ping/shared';
import {
  createRootRoute,
  createRoute,
  createRouter,
  notFound,
  Outlet,
  type RouterHistory,
  useParams,
} from '@tanstack/react-router';
import { AppShell, HomeNote } from './components/AppShell';
import { PageNotFound } from './components/NotFound';
import { BrowseChannelsPage } from './features/channel/BrowseChannelsPage';
import { ChannelPage } from './features/channel/ChannelPage';
import { StaffMembersPage } from './features/staff/StaffMembersPage';
import { useThreadListView } from './features/thread/list-view';
import { PingsPage } from './features/thread/PingsPage';
import { StartThreadButton } from './features/thread/StartThreadDialog';
import { ThreadList } from './features/thread/ThreadList';
import { ThreadListControls } from './features/thread/ThreadListControls';
import { ThreadPanel } from './features/thread/ThreadPanel';

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

// The Channel view, on its Threads tab. An open Thread is a child route, so the feed stays
// mounted (and scrolled) behind its panel.
const channelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/channels/$channelId',
  params: channelRouteParams,
  component: ChannelRoute,
});

function ChannelRoute() {
  const { channelId } = channelRoute.useParams();
  // Keyed so each Channel reads its own kept Thread list view.
  return <ChannelThreads key={channelId} channelId={channelId} />;
}

function ChannelThreads({ channelId }: { channelId: string }) {
  const { threadId } = useParams({ strict: false });
  const [view, setView] = useThreadListView(channelId);
  return (
    <ChannelPage
      channelId={channelId}
      tab="threads"
      startThread={<StartThreadButton channelId={channelId} />}
      listControls={<ThreadListControls channelId={channelId} view={view} onChange={setView} />}
      panel={<Outlet />}
    >
      <ThreadList channelId={channelId} view={view} openThreadId={threadId} />
    </ChannelPage>
  );
}

// An open Thread: a panel beside the feed on a laptop, full screen on a phone. Its IDs
// must pass the schema, or it's not found.
const threadRoute = createRoute({
  getParentRoute: () => channelRoute,
  path: 'threads/$threadId',
  params: {
    parse: (raw: Record<string, string>) => {
      const parsed = threadParams.safeParse(raw);
      if (!parsed.success) throw notFound();
      return { threadId: parsed.data.threadId };
    },
    stringify: (params: { threadId: string }) => params,
  },
  component: ThreadRoute,
});

function ThreadRoute() {
  const { channelId, threadId } = threadRoute.useParams();
  return <ThreadPanel key={threadId} channelId={channelId} threadId={threadId} />;
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

// The Pings view: Threads with a Ping for the Staff member, from the sidebar.
const pingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pings',
  component: PingsPage,
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
  pingsRoute,
  channelRoute.addChildren([threadRoute]),
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
