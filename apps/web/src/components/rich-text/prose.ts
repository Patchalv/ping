// How rich text looks, in the editor and when read: one set of utilities, applied to the
// container, so both match. Body text is 15px (DESIGN.md › Typography); headings step up
// within the six sizes.
export const PROSE = [
  'text-base leading-[1.45] break-words',
  '[&>*+*]:mt-2 [&_li>*+*]:mt-1',
  // The editor's h1–h3. The view renders them two levels down, marked with data-level,
  // and an attribute outranks a tag, so the view's h3 still looks like an h1.
  '[&_h1]:text-xl [&_h1]:font-bold [&_h2]:text-lg [&_h2]:font-bold [&_h3]:text-base [&_h3]:font-bold',
  '[&_[data-level=1]]:text-xl [&_[data-level=2]]:text-lg [&_[data-level=3]]:text-base',
  '[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-6 [&_ol]:pl-6',
  '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
  '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-sm',
  '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
].join(' ');
