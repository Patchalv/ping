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
import { ChannelPage } from './features/channel/ChannelPage';

const rootRoute = createRootRoute({ component: AppShell, notFoundComponent: PageNotFound });

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeNote,
});

const channelRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/channels/$channelId',
  params: {
    parse: (raw) => {
      const parsed = channelParams.safeParse(raw);
      if (!parsed.success) throw notFound();
      return parsed.data;
    },
    stringify: (params) => params,
  },
  component: ChannelRoute,
});

function ChannelRoute() {
  const { channelId } = channelRoute.useParams();
  return <ChannelPage key={channelId} channelId={channelId} />;
}

const routeTree = rootRoute.addChildren([homeRoute, channelRoute]);

/** The browser's router by default; tests pass a memory history. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, trailingSlash: 'preserve', ...(history ? { history } : {}) });
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
