// A panel on the right of the main area, such as the Thread view (screens.md › Thread
// view; DESIGN.md › Layout). On a laptop the Staff member drags its left edge, or focuses
// the edge and uses the arrow keys, and the width is kept in this browser. On a phone it
// covers the screen. Copies SidebarResizeHandle's behaviour.
import { type CSSProperties, type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { readStored, writeStored } from '#/lib/storage';
import { cn } from '#/lib/utils';

const WIDTH_KEY = 'ping-thread-panel-width';
const WIDTH = { initial: 480, min: 360, max: 800, step: 16 };

const clampWidth = (width: number) => Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, width)));

export function SidePanel({
  label,
  className,
  children,
}: {
  /** The panel's accessible name, such as the Thread's title. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  const [width, setWidthState] = useState(() =>
    clampWidth(Number(readStored(WIDTH_KEY)) || WIDTH.initial),
  );
  function setWidth(next: number) {
    const clamped = clampWidth(next);
    writeStored(WIDTH_KEY, String(clamped));
    setWidthState(clamped);
  }

  return (
    <section
      aria-label={label}
      style={{ '--panel-width': `${width}px` } as CSSProperties}
      className={cn(
        'relative flex min-h-0 flex-col bg-background max-md:fixed max-md:inset-0 max-md:z-40 md:w-(--panel-width) md:max-w-[60%] md:shrink-0 md:border-l',
        className,
      )}
    >
      <ResizeHandle width={width} setWidth={setWidth} />
      {children}
    </section>
  );
}

/** The panel's left edge. Dragging left widens it, so the arrow keys follow the edge. */
function ResizeHandle({ width, setWidth }: { width: number; setWidth(width: number): void }) {
  const drag = useRef<{ x: number; width: number } | null>(null);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = {
      ArrowLeft: width + WIDTH.step,
      ArrowRight: width - WIDTH.step,
      Home: WIDTH.max,
      End: WIDTH.min,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setWidth(next);
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable, adjustable separator has no native element; <hr> can't take focus or a value
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      aria-valuemin={WIDTH.min}
      aria-valuemax={WIDTH.max}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width };
      }}
      onPointerMove={(event) => {
        if (drag.current) setWidth(drag.current.width - (event.clientX - drag.current.x));
      }}
      onLostPointerCapture={() => {
        drag.current = null;
      }}
      onDoubleClick={() => setWidth(WIDTH.initial)}
      onKeyDown={onKeyDown}
      className="absolute inset-y-0 -left-1.5 z-10 hidden w-3 cursor-col-resize touch-none outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-0.5 after:-translate-x-1/2 after:transition-colors hover:after:bg-ring focus-visible:after:bg-ring md:block"
    />
  );
}
