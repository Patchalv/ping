import type { ComponentProps } from 'react';
import { navigate } from '../lib/router';

/**
 * A link inside the SPA. A plain click navigates without a page load; a modified or
 * middle click falls through to the browser, so opening in a new tab still works.
 */
export function AppLink({ href, onClick, ...props }: ComponentProps<'a'> & { href: string }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        if (event.button !== 0) return;
        event.preventDefault();
        navigate(href);
      }}
    />
  );
}
