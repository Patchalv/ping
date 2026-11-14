// The SPA's routes, on the History API. The server answers every non-API path with
// index.html, so a deep link to a Channel loads the app and lands here.
import { useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'channel'; channelId: string }
  | { name: 'notFound' };

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CHANNEL = new RegExp(`^/channels/(${UUID})/?$`, 'i');

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const channel = CHANNEL.exec(pathname);
  if (channel?.[1]) return { name: 'channel', channelId: channel[1] };
  return { name: 'notFound' };
}

export const channelPath = (channelId: string) => `/channels/${channelId}`;

const NAVIGATE = 'ping:navigate';

export function navigate(path: string): void {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE, onChange);
  };
}

/** The current route, re-rendering on navigate() and the browser's back and forward. */
export function useRoute(): Route {
  const pathname = useSyncExternalStore(subscribe, () => window.location.pathname);
  return parseRoute(pathname);
}
