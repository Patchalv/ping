import type { EditedMark as EditedMarkData } from '@ping/shared';
import { EllipsisIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '#/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu';

/**
 * The ⋯ menu on a Thread or Thread Response, holding the actions the viewer may take.
 * `label` names it for screen readers ("Thread actions").
 */
export function ContentMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label={label} className="shrink-0" />}
      >
        <EllipsisIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ContentMenuEdit({ onClick }: { onClick(): void }) {
  return <DropdownMenuItem onClick={onClick}>Edit</DropdownMenuItem>;
}

export function ContentMenuDelete({ onClick }: { onClick(): void }) {
  return (
    <DropdownMenuItem variant="destructive" onClick={onClick}>
      Delete…
    </DropdownMenuItem>
  );
}

/** "edited", or "edited by <name>" when someone other than the author edited it. */
export function EditedMark({ edited }: { edited: EditedMarkData | null }) {
  if (!edited) return null;
  return (
    <span className="text-xs text-muted-foreground">
      {edited.by ? `edited by ${edited.by.name}` : 'edited'}
    </span>
  );
}
