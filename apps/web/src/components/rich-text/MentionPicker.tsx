// The @ picker (screens.md › Composer): typing @ in the editor lists the Staff members who
// can read the Thread, and picking one adds a Mention node that stores their ID. Focus
// stays in the editor throughout: the arrow keys move the active option, announced through
// aria-activedescendant, Enter or Tab picks it, and Escape closes the list (not the dialog
// around the composer).
import type { MentionCandidate } from '@ping/shared';
import Mention from '@tiptap/extension-mention';
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion';
import type { RefObject } from 'react';
import { matchMentionCandidates } from './mention-query';

/** The picker while it's open: who it offers, which one is active, and where the @ is. */
export type Picking = {
  items: MentionCandidate[];
  selected: number;
  /** Where the list opens, below the typed @, inside the editor's frame. */
  position: { top: number; left: number } | null;
  choose(item: MentionCandidate): void;
};

type SetPicking = (next: (last: Picking | null) => Picking | null) => void;

/** What the extension reads when it runs, outside React's render. */
export type PickerSource = {
  candidates: readonly MentionCandidate[];
  picking: Picking | null;
  setPicking: SetPicking;
};

/** The Mention extension, wired to the picker through `source`. */
export function mentionExtension(source: RefObject<PickerSource>) {
  const show = (props: SuggestionProps<MentionCandidate>) =>
    source.current.setPicking((last) => ({
      items: props.items,
      // Keep the active option while typing narrows the list, as long as it's there.
      selected: last ? Math.min(last.selected, Math.max(props.items.length - 1, 0)) : 0,
      position: positionBelow(props),
      choose: (item) => props.command({ id: item.staffId, label: item.name }),
    }));
  return Mention.configure({
    HTMLAttributes: { class: 'font-semibold text-primary' },
    suggestion: {
      // Full names have spaces in them.
      allowSpaces: true,
      items: ({ query }) => matchMentionCandidates(source.current.candidates, query),
      render: () => ({
        onStart: show,
        onUpdate: show,
        onKeyDown: (props) => pickerKeyDown(source.current, props),
        onExit: () => source.current.setPicking(() => null),
      }),
    },
  });
}

/** w-64: the list's width, in pixels. */
const LIST_WIDTH = 256;

/** Below the typed @, relative to the editor's frame, kept inside it. */
function positionBelow(props: SuggestionProps<MentionCandidate>) {
  const at = props.clientRect?.();
  const frame = props.editor.view.dom
    .closest('[data-slot="rich-text-editor"]')
    ?.getBoundingClientRect();
  if (!at || !frame) return null;
  return {
    top: at.bottom - frame.top + 4,
    left: Math.max(0, Math.min(at.left - frame.left, frame.width - LIST_WIDTH)),
  };
}

function pickerKeyDown(source: PickerSource, { event }: SuggestionKeyDownProps): boolean {
  if (event.key === 'Escape') {
    // The suggestion closes itself; keep the key from closing the dialog too.
    event.stopPropagation();
    return true;
  }
  const picking = source.picking;
  if (!picking || picking.items.length === 0) return false;
  const step = (by: number) =>
    source.setPicking((last) =>
      last && last.items.length > 0
        ? { ...last, selected: (last.selected + by + last.items.length) % last.items.length }
        : last,
    );
  switch (event.key) {
    case 'ArrowDown':
      step(1);
      return true;
    case 'ArrowUp':
      step(-1);
      return true;
    case 'Enter':
    case 'Tab': {
      const item = picking.items[picking.selected];
      if (!item) return false;
      picking.choose(item);
      return true;
    }
    default:
      return false;
  }
}

/** The id of the active option, for the editor's aria-activedescendant. */
export const optionId = (listboxId: string, picking: Picking): string | undefined => {
  const item = picking.items[picking.selected];
  return item ? `${listboxId}-${item.staffId}` : undefined;
};

/** The list, placed below the typed @ inside the editor's frame. */
export function MentionPicker({ id, picking }: { id: string; picking: Picking }) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label="People to Mention"
      style={picking.position ?? undefined}
      className="absolute z-50 w-64 max-w-full overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
    >
      {picking.items.length === 0 ? (
        <p className="px-2 py-1.5 text-sm text-muted-foreground">
          No one by that name can read this Thread.
        </p>
      ) : (
        picking.items.map((item, index) => (
          // Focus stays in the editor, which handles the keys; a click picks the option.
          // biome-ignore lint/a11y/useKeyWithClickEvents: the editor handles the keys for the list.
          <div
            key={item.staffId}
            id={`${id}-${item.staffId}`}
            role="option"
            aria-selected={index === picking.selected}
            tabIndex={-1}
            // Keep focus, and the typed @, in the editor while clicking.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => picking.choose(item)}
            className="cursor-pointer truncate rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent aria-selected:text-accent-foreground"
          >
            {item.name}
          </div>
        ))
      )}
    </div>
  );
}
