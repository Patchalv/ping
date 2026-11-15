// shadcn's Sidebar, adapted to Ping's shell (screens.md › Laptop and › Phone; ADR 0007):
// - it sits in the page flow under the top bar, not fixed to the viewport;
// - on a phone it is the home screen, full width, never a slide-out sheet;
// - the Staff member can drag it wider or narrower (or use the arrow keys on the handle),
//   and hide it with ⌘B or Ctrl+B; both choices are kept in this browser, not a cookie.
import { mergeProps } from '@base-ui/react/merge-props';
import { useRender } from '@base-ui/react/use-render';
import { cn } from 'cn';
import { PanelLeftIcon } from 'lucide-react';
import {
  type ComponentProps,
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  use,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';

const OPEN_KEY = 'ping-sidebar-open';
const WIDTH_KEY = 'ping-sidebar-width';
const WIDTH = { initial: 260, min: 200, max: 420, step: 16 };

const clampWidth = (width: number) => Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, width)));

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice lasts for this visit only.
  }
}

/** Whether a key press belongs to a text field, where ⌘B means bold. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || target.matches('input, textarea, select'));

type SidebarContextValue = {
  open: boolean;
  toggle(): void;
  width: number;
  setWidth(width: number): void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = use(SidebarContext);
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.');
  return context;
}

/** Holds the sidebar's open state and width for the shell inside it. */
export function SidebarProvider({ className, style, ...props }: ComponentProps<'div'>) {
  const [open, setOpen] = useState(() => readStored(OPEN_KEY) !== 'false');
  const [width, setWidthState] = useState(() =>
    clampWidth(Number(readStored(WIDTH_KEY)) || WIDTH.initial),
  );

  function toggle() {
    writeStored(OPEN_KEY, String(!open));
    setOpen(!open);
  }

  function setWidth(next: number) {
    const clamped = clampWidth(next);
    writeStored(WIDTH_KEY, String(clamped));
    setWidthState(clamped);
  }

  // eslint-disable-next-line no-restricted-syntax -- syncs with document keyboard events: ⌘B or Ctrl+B hides or shows the sidebar
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'b' || !(event.metaKey || event.ctrlKey) || isTyping(event.target)) return;
      event.preventDefault();
      writeStored(OPEN_KEY, String(!open));
      setOpen(!open);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <SidebarContext value={{ open, toggle, width, setWidth }}>
      <div
        data-slot="sidebar-wrapper"
        style={{ '--sidebar-width': `${width}px`, ...style } as CSSProperties}
        className={cn('group/sidebar-wrapper', className)}
        {...props}
      />
    </SidebarContext>
  );
}

/** The dark sidebar. Hidden on a laptop when collapsed; full width on a phone. */
export function Sidebar({ className, ...props }: ComponentProps<'div'>) {
  const { open } = useSidebar();
  return (
    <div
      data-slot="sidebar"
      data-state={open ? 'expanded' : 'collapsed'}
      className={cn(
        'peer relative flex min-h-0 flex-col bg-sidebar text-sidebar-foreground max-md:w-full md:w-(--sidebar-width) md:shrink-0 md:data-[state=collapsed]:hidden',
        className,
      )}
      {...props}
    />
  );
}

/** The handle on the sidebar's right edge: drag it, or focus it and use the arrow keys. */
export function SidebarResizeHandle({ className, ...props }: ComponentProps<'div'>) {
  const { width, setWidth } = useSidebar();
  const drag = useRef<{ x: number; width: number } | null>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = {
      ArrowLeft: width - WIDTH.step,
      ArrowRight: width + WIDTH.step,
      Home: WIDTH.min,
      End: WIDTH.max,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setWidth(next);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable, adjustable separator has no native element; <hr> can't take focus or a value
    <div
      data-slot="sidebar-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={WIDTH.min}
      aria-valuemax={WIDTH.max}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current) setWidth(drag.current.width + event.clientX - drag.current.x);
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onDoubleClick={() => setWidth(WIDTH.initial)}
      onKeyDown={onKeyDown}
      className={cn(
        'absolute inset-y-0 -right-1.5 z-10 hidden w-3 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors hover:after:bg-sidebar-ring focus-visible:after:bg-sidebar-ring md:block',
        className,
      )}
      {...props}
    />
  );
}

/** The top bar button that hides or shows the sidebar. Laptop only. */
export function SidebarTrigger({ className, ...props }: ComponentProps<typeof Button>) {
  const { open, toggle } = useSidebar();
  return (
    <Button
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      aria-label={open ? 'Hide sidebar' : 'Show sidebar'}
      aria-keyshortcuts="Meta+B Control+B"
      onClick={toggle}
      className={cn('max-md:hidden', className)}
      {...props}
    >
      <PanelLeftIcon />
    </Button>
  );
}

/** The main area: a rounded panel inset on the chrome on a laptop, full bleed on a phone. */
export function SidebarInset({ className, ...props }: ComponentProps<'main'>) {
  return (
    <main
      data-slot="sidebar-inset"
      className={cn(
        'relative min-w-0 flex-1 overflow-auto bg-feed md:mr-1.5 md:mb-1.5 md:rounded-lg md:peer-data-[state=collapsed]:ml-1.5',
        className,
      )}
      {...props}
    />
  );
}

export function SidebarHeader({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

export function SidebarFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      className={cn('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

export function SidebarSeparator({ className, ...props }: ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="sidebar-separator"
      className={cn('mx-3 w-auto bg-sidebar-border', className)}
      {...props}
    />
  );
}

export function SidebarContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-auto py-2', className)}
      {...props}
    />
  );
}

export function SidebarGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group"
      className={cn('relative flex w-full min-w-0 flex-col px-2 py-1', className)}
      {...props}
    />
  );
}

export function SidebarGroupLabel({
  className,
  render,
  ...props
}: useRender.ComponentProps<'div'> & ComponentProps<'div'>) {
  return useRender({
    defaultTagName: 'div',
    props: mergeProps<'div'>(
      {
        className: cn(
          'flex h-7 shrink-0 items-center rounded-md px-2 text-small font-medium text-sidebar-muted-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'sidebar-group-label' },
  });
}

export function SidebarGroupAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<'button'> & ComponentProps<'button'>) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(
          'absolute top-1.5 right-3 flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'sidebar-group-action' },
  });
}

export function SidebarGroupContent({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div data-slot="sidebar-group-content" className={cn('w-full text-sm', className)} {...props} />
  );
}

export function SidebarMenu({ className, ...props }: ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu"
      className={cn('flex w-full min-w-0 flex-col gap-px', className)}
      {...props}
    />
  );
}

export function SidebarMenuItem({ className, ...props }: ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-item"
      className={cn('group/menu-item relative', className)}
      {...props}
    />
  );
}

/**
 * A row in the sidebar. Render it as a router link with `render`; the link's
 * `aria-current="page"` marks the active row.
 */
export function SidebarMenuButton({
  render,
  className,
  ...props
}: useRender.ComponentProps<'button'> & ComponentProps<'button'>) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(
          'peer/menu-button flex h-7 w-full items-center gap-2 overflow-hidden rounded-md px-2 text-left text-sm whitespace-nowrap text-sidebar-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:pointer-events-none disabled:opacity-50 aria-[current=page]:bg-sidebar-primary aria-[current=page]:text-sidebar-primary-foreground max-md:h-10 max-md:px-3 max-md:text-base group-has-data-[slot=sidebar-menu-badge]/menu-item:pr-8 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:opacity-80 [&>span:last-child]:truncate',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'sidebar-menu-button' },
  });
}

export function SidebarMenuAction({
  className,
  render,
  ...props
}: useRender.ComponentProps<'button'> & ComponentProps<'button'>) {
  return useRender({
    defaultTagName: 'button',
    props: mergeProps<'button'>(
      {
        className: cn(
          'absolute top-0.5 right-1 flex size-6 items-center justify-center rounded-md text-sidebar-muted-foreground outline-hidden hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring [&>svg]:size-4 [&>svg]:shrink-0',
          className,
        ),
      },
      props,
    ),
    render,
    state: { slot: 'sidebar-menu-action' },
  });
}

/** A count at the end of a row, such as the Threads with a Ping. */
export function SidebarMenuBadge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="sidebar-menu-badge"
      className={cn(
        'pointer-events-none absolute top-1/2 right-2 flex h-4.5 min-w-4.5 -translate-y-1/2 items-center justify-center rounded-full bg-ping px-1.5 text-xs font-bold text-ping-foreground tabular-nums select-none',
        className,
      )}
      {...props}
    />
  );
}
