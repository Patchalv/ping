// Class joining and Tailwind conflict resolution, taught Ping's custom type step. Without
// this, `text-small` (13px, index.css) looks like a text colour, and a later colour class
// silently drops it. shadcn's generated components import `cn` from here
// (components.json › aliases.utils).
import { createCn } from 'cn/config';

export const cn = createCn({
  extend: { classGroups: { 'font-size': [{ text: ['small'] }] } },
});
