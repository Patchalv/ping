// The TipTap editor for Thread descriptions and, later, Thread Responses (screens.md ›
// Composer). It offers only the allowlist (ADR 0003): StarterKit without horizontal
// rules, headings 1–3, and links limited to http, https and mailto. The server checks
// again, whatever arrives.
import { isAllowedLinkHref, RICH_TEXT_MESSAGES, type RichTextDoc } from '@ping/shared';
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  BoldIcon,
  CodeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  type LucideIcon,
  SquareCodeIcon,
  StrikethroughIcon,
  TextQuoteIcon,
  UnderlineIcon,
} from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Button } from '#/components/ui/button';
import { Input } from '#/components/ui/input';
import { cn } from '#/lib/utils';
import { PROSE } from './prose';

const EXTENSIONS = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    horizontalRule: false,
    link: {
      openOnClick: false,
      autolink: true,
      defaultProtocol: 'https',
      isAllowedUri: (url) => isAllowedLinkHref(url),
      shouldAutoLink: (url) => isAllowedLinkHref(url) || isAllowedLinkHref(`https://${url}`),
    },
  }),
];

type Props = {
  /** The starting document. Later changes come from the editor, through onChange. */
  defaultValue: RichTextDoc;
  onChange(doc: RichTextDoc): void;
  onBlur(): void;
  /** Put on the editable element, the one that takes focus: id, aria and data-field. */
  attributes: Record<string, string>;
};

export function RichTextEditor({ defaultValue, onChange, onBlur, attributes }: Props) {
  const editor = useEditor({
    extensions: EXTENSIONS,
    content: defaultValue,
    editorProps: {
      attributes: {
        ...attributes,
        role: 'textbox',
        'aria-multiline': 'true',
        tabindex: '0',
        class: cn(
          PROSE,
          'min-h-28 px-3 py-2 outline-none max-md:text-[1rem] [&_p.is-editor-empty:first-child]:min-h-6',
        ),
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getJSON() as RichTextDoc),
    onBlur: () => onBlur(),
  });

  return (
    <div
      data-slot="rich-text-editor"
      className="rounded-lg border border-input bg-background text-foreground shadow-xs transition-[color,box-shadow] duration-200 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/30 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20"
    >
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

type Format = {
  label: string;
  icon: LucideIcon;
  isActive(editor: Editor): boolean;
  run(editor: Editor): void;
};

const FORMATS: Format[][] = [
  [
    {
      label: 'Bold',
      icon: BoldIcon,
      isActive: (e) => e.isActive('bold'),
      run: (e) => e.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: ItalicIcon,
      isActive: (e) => e.isActive('italic'),
      run: (e) => e.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Underline',
      icon: UnderlineIcon,
      isActive: (e) => e.isActive('underline'),
      run: (e) => e.chain().focus().toggleUnderline().run(),
    },
    {
      label: 'Strikethrough',
      icon: StrikethroughIcon,
      isActive: (e) => e.isActive('strike'),
      run: (e) => e.chain().focus().toggleStrike().run(),
    },
    {
      label: 'Inline code',
      icon: CodeIcon,
      isActive: (e) => e.isActive('code'),
      run: (e) => e.chain().focus().toggleCode().run(),
    },
  ],
  [
    {
      label: 'Heading 1',
      icon: Heading1Icon,
      isActive: (e) => e.isActive('heading', { level: 1 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      label: 'Heading 2',
      icon: Heading2Icon,
      isActive: (e) => e.isActive('heading', { level: 2 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      label: 'Heading 3',
      icon: Heading3Icon,
      isActive: (e) => e.isActive('heading', { level: 3 }),
      run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    },
  ],
  [
    {
      label: 'Bulleted list',
      icon: ListIcon,
      isActive: (e) => e.isActive('bulletList'),
      run: (e) => e.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: ListOrderedIcon,
      isActive: (e) => e.isActive('orderedList'),
      run: (e) => e.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Quote',
      icon: TextQuoteIcon,
      isActive: (e) => e.isActive('blockquote'),
      run: (e) => e.chain().focus().toggleBlockquote().run(),
    },
    {
      label: 'Code block',
      icon: SquareCodeIcon,
      isActive: (e) => e.isActive('codeBlock'),
      run: (e) => e.chain().focus().toggleCodeBlock().run(),
    },
  ],
];

const ALL_FORMATS = FORMATS.flat();

function Toolbar({ editor }: { editor: Editor }) {
  // Re-renders only when an active state changes, not on every keystroke.
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      formats: ALL_FORMATS.map((format) => format.isActive(current)),
      link: current.isActive('link'),
    }),
  });
  const [linking, setLinking] = useState(false);

  return (
    <div className="border-b">
      <div
        role="toolbar"
        aria-label="Formatting"
        className="flex flex-wrap items-center gap-0.5 p-1"
      >
        {FORMATS.map((group, groupIndex) => (
          <div key={group[0]?.label} className="flex items-center gap-0.5">
            {groupIndex > 0 ? (
              <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
            ) : null}
            {group.map((format) => (
              <ToolbarButton
                key={format.label}
                label={format.label}
                icon={format.icon}
                pressed={active.formats[ALL_FORMATS.indexOf(format)] ?? false}
                onPress={() => format.run(editor)}
              />
            ))}
          </div>
        ))}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
        <ToolbarButton
          label="Link"
          icon={LinkIcon}
          pressed={active.link}
          onPress={() => setLinking((open) => !open)}
        />
      </div>
      {linking ? (
        <LinkForm
          editor={editor}
          initial={(editor.getAttributes('link').href as string | undefined) ?? ''}
          onDone={() => setLinking(false)}
        />
      ) : null}
    </div>
  );
}

function ToolbarButton({
  label,
  icon: Icon,
  pressed,
  onPress,
}: {
  label: string;
  icon: LucideIcon;
  pressed: boolean;
  onPress(): void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className="aria-pressed:bg-muted aria-pressed:text-foreground"
      // Keep the selection in the editor while clicking.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}

/** Adds, changes or removes the link on the selected text. */
function LinkForm({
  editor,
  initial,
  onDone,
}: {
  editor: Editor;
  initial: string;
  onDone(): void;
}) {
  const [href, setHref] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  function apply(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    const trimmed = href.trim();
    if (trimmed === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      onDone();
      return;
    }
    // "example.com" means https://example.com.
    const full = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    if (!isAllowedLinkHref(full)) {
      setError(RICH_TEXT_MESSAGES.link);
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: full }).run();
    onDone();
  }

  return (
    // A nested <form> isn't allowed, so Enter in the field, or Apply, sets the link.
    <fieldset
      aria-label="Link"
      className="m-0 flex min-w-0 flex-wrap items-center gap-2 border-0 border-t px-2 py-1.5"
    >
      <Input
        // Opened on purpose from the Link button, so the address field takes focus.
        autoFocus
        onKeyDown={(event) => {
          if (event.key === 'Enter') apply(event);
          if (event.key === 'Escape') {
            // Close the link field, not the dialog around the composer.
            event.preventDefault();
            event.stopPropagation();
            onDone();
          }
        }}
        className="h-7 min-w-0 flex-1"
        type="url"
        aria-label="Link address"
        aria-invalid={error ? true : undefined}
        placeholder="https://"
        value={href}
        onChange={(event) => {
          setHref(event.target.value);
          setError(null);
        }}
      />
      <Button type="button" size="sm" onClick={apply}>
        Apply
      </Button>
      {initial ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
            onDone();
          }}
        >
          Remove link
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
