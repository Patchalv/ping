---
name: Ping
description: Spark's staff tool for Channels, Threads and Pings, built for all-day triage.
colors:
  ink-navy-chrome: "oklch(0.219 0.043 261.6)"
  ink-navy-sidebar: "oklch(0.259 0.052 263.1)"
  sidebar-hover: "oklch(0.315 0.058 263.3)"
  sidebar-text: "oklch(0.864 0.025 259.8)"
  sidebar-muted: "oklch(0.729 0.038 261.3)"
  sidebar-active: "oklch(0.508 0.168 267.9)"
  indigo-primary: "oklch(0.47 0.158 267.4)"
  ping-pink: "oklch(0.539 0.193 6.5)"
  saved-green: "oklch(0.512 0.129 148.9)"
  danger-red: "oklch(0.5 0.182 29.5)"
  danger-surface: "oklch(0.972 0.012 23.7)"
  panel-white: "oklch(1 0 0)"
  feed-mist: "oklch(0.973 0.006 264.5)"
  ink-text: "oklch(0.24 0.024 267)"
  slate-muted: "oklch(0.512 0.031 262.2)"
  hairline: "oklch(0.911 0.012 259.8)"
  field-edge: "oklch(0.82 0.018 260)"
  night-chrome: "oklch(0.174 0.029 264.7)"
  night-sidebar: "oklch(0.201 0.034 263.4)"
  night-panel: "oklch(0.236 0.02 264)"
  night-feed: "oklch(0.2 0.017 264.1)"
  night-text: "oklch(0.933 0.009 264.5)"
  night-muted: "oklch(0.717 0.029 262.3)"
  night-indigo: "oklch(0.727 0.114 272.2)"
  night-ping: "oklch(0.708 0.162 1.5)"
  night-saved: "oklch(0.735 0.142 151.1)"
  night-danger: "oklch(0.709 0.17 26.5)"
typography:
  page-title:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: "1.75rem"
  channel-title:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: "1.5rem"
  body:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.45
  control:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 500
    lineHeight: "1.25rem"
  small:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
    lineHeight: "1.125rem"
  meta:
    fontFamily: "Figtree Variable, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "14px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.indigo-primary}"
    textColor: "{colors.panel-white}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-outline:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink-text}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  button-destructive:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger-red}"
    rounded: "{rounded.lg}"
    padding: "0 12px"
    height: "32px"
  input:
    backgroundColor: "{colors.panel-white}"
    textColor: "{colors.ink-text}"
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    height: "32px"
  sidebar-item:
    textColor: "{colors.sidebar-text}"
    typography: "{typography.control}"
    rounded: "{rounded.md}"
    padding: "0 8px"
    height: "28px"
  sidebar-item-hover:
    backgroundColor: "{colors.sidebar-hover}"
  sidebar-item-active:
    backgroundColor: "{colors.sidebar-active}"
    textColor: "{colors.panel-white}"
  ping-badge:
    backgroundColor: "{colors.ping-pink}"
    textColor: "{colors.panel-white}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    height: "18px"
  tag:
    textColor: "{colors.slate-muted}"
    typography: "{typography.meta}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
    height: "20px"
---

# Design System: Ping

## Overview

**Creative North Star: "The Quiet Control Room"**

Ping is where Spark's staff spend their working day clearing Pings and following Threads, so the room has to stay calm for eight hours. A steady ink navy frame (top bar and sidebar) holds a bright work surface: a white panel inset on the chrome on a laptop, over a cool, navy-tinted grey feed. Nothing in the frame competes for attention. Colour appears only where something needs a person: a pink Ping count, a green Saved marker, an indigo action.

The density is a chat tool's: 15px reading text, 14px controls, 28px sidebar rows, so a Staff member triaging all day sees a long list without scrolling. The components are soft and friendly rather than technical: gently rounded corners, pill-shaped tags and counts, plain words. The shell is shadcn/ui on Base UI (ADR 0007), adapted rather than restyled from scratch.

Light and dark are equal citizens. In dark mode the chrome deepens to a near-black navy, so the dark panel still reads as the lit work surface.

**Key Characteristics:**
- Ink navy chrome around a bright, inset work surface.
- Colour is a signal, never decoration: indigo acts, pink needs you, green is Saved, red is danger.
- Compact density with soft, friendly shapes.
- Flat surfaces separated by tone; shadows only on things that float.
- Every text pair meets WCAG AA, in both themes.

## Colors

A cool, low-chroma navy family carries the whole frame, so the four signal colours stand out by contrast alone.

### Primary
- **Ink Indigo** (indigo-primary; night-indigo in dark): primary buttons, links, the active tab underline, focus rings and the checked radio. White on it is 7.1:1.

### Secondary
- **Ping Pink** (ping-pink; night-ping in dark): only for "this needs you": the Ping count on the sidebar, unread counts, "@You" and "N new". 5.7:1 on white. In dark mode the badge flips to light pink with near-black text.
- **Saved Green** (saved-green; night-saved in dark): only for the Saved marker and the Saved count. 5.4:1 on white.

### Tertiary
- **Alarm Red** (danger-red, on danger-surface; night-danger in dark): destructive buttons, field errors and form errors. Deliberately deeper and more orange than Ping Pink, so "needs you" never reads as "something broke".

### Neutral
- **Ink Navy Chrome** (ink-navy-chrome): the top bar and the page behind the inset panel.
- **Ink Navy Sidebar** (ink-navy-sidebar): the sidebar, one step lighter than the top bar. Its rows use Sidebar Text (10.4:1), section labels use Sidebar Muted (6.5:1), hover uses Sidebar Hover, and the current Channel uses Sidebar Active with white text (6.0:1).
- **Panel White** (panel-white; night-panel in dark): the Channel bar, cards, dialogs and menus.
- **Feed Mist** (feed-mist; night-feed in dark): the feed behind Thread rows and empty states.
- **Ink Text** (ink-text; night-text in dark): all body text (16.5:1 on white).
- **Slate Muted** (slate-muted; night-muted in dark): descriptions, timestamps, member counts and hints (5.7:1 on white, 5.3:1 on Feed Mist).
- **Hairline** (hairline): borders between surfaces. **Field Edge** (field-edge): the stronger outline on inputs, textareas and radios, so fields are findable.
- **Avatar tints** (`--avatar-1` to `--avatar-6` in `index.css`): coloured initials, the one place colour tells people apart rather than signalling. Each is a pale tint with deep text of the same hue (a deep fill with pale text in dark), AA in both themes, picked by Staff member ID so a rename never changes it. The hues (45, 85, 195, 240, 285, 315) stay clear of Ping Pink and Saved Green.

### Named Rules
**The Signal Rule.** Pink, green, indigo and red each mean one thing. Never use Ping Pink for decoration, a brand moment or an error, and never use a signal colour as a large fill.

**The Tinted Neutral Rule.** Greys lean toward the navy hue (about 260 in OKLCH, low chroma). Don't introduce a pure grey or a warm stone.

## Typography

**Body Font:** Figtree Variable (with system-ui, sans-serif), self-hosted from `@fontsource-variable/figtree`.

**Character:** a warm, open geometric sans that stays readable across a full day of reading and writing. One family does everything; hierarchy comes from size and weight.

### Hierarchy
- **Page title** (700, 22px, 28px line-height): sign-in and not-found headings, dialog-level page titles.
- **Channel title** (700, 18px, 24px): the Channel name in the Channel bar, dialog titles, Thread titles later.
- **Body** (400, 15px, 1.45): Thread and Thread Response text, descriptions, empty states. The Tailwind `text-base` step.
- **Control** (500, 14px, 20px): sidebar rows, buttons, inputs, menu items. `text-sm`.
- **Small** (500, 13px, 18px): tabs, section labels, member counts, the name and email in the avatar menu. `text-small`.
- **Meta** (400, 12px, 16px): timestamps, tags, badges. `text-xs`.

### Named Rules
**The Six Sizes Rule.** Use only the six steps above (`text-xs`, `text-small`, `text-sm`, `text-base`, `text-lg`, `text-xl`). The one exception is the Ping wordmark on the sign-in page.

**The 16px Field Rule.** On a phone, inputs and textareas render at 16px so iOS doesn't zoom on focus. They drop to 14px from the `md` breakpoint.

## Layout

The shell is a two-row grid: a 44px top bar across the full width, then the sidebar and the main area side by side.

- **Laptop (768px and up):** the sidebar starts at 260px. The Staff member can drag it between 200px and 420px or move it with the arrow keys on the handle, and double-clicking resets it. ⌘B or Ctrl+B hides it. The main area is a panel inset on the chrome with a 6px gutter on the right and bottom (and on the left when the sidebar is hidden), and it is the only scroll container. The Channel bar sticks to its top.
- **Phone (below 768px):** no inset. The sidebar is the home screen at full width with 40px rows. Opening a Channel replaces it, and the Channel bar shows a "‹ Channels" link back. Search sits behind an icon. Buttons grow to 40px tall for touch.
- **Rhythm:** Tailwind's 4px scale. Common steps are 8px inside controls, 12–16px between fields, 16–20px of side padding in the main area (16px on a phone), and 24px of padding in dialogs and cards.
- **Thread panel (#38):** opens on the right of the Channel view, resizable the same way as the sidebar: a focusable drag handle (arrow keys, double-click to reset) and a width kept in this browser. Copy `SidebarResizeHandle`, not shadcn's `Resizable`.

## Elevation & Depth

Flat by default. Chrome, panel and feed separate by tone alone: the navy frame, the white panel and the misted feed. Only things that float above the page cast a shadow.

### Shadow Vocabulary
- **Float** (`shadow-lg`, Tailwind's two-layer large shadow, plus a 1px ring at 5% foreground): dropdown menus and popovers.
- **Modal** (`shadow-xl` with the same ring, over a 50% black backdrop with no blur): dialogs.
- **Card on chrome** (`shadow-lg`): the sign-in card, the only card that sits directly on the navy.

### Named Rules
**The Flat-By-Default Rule.** Thread rows, the Channel bar and the inset panel have no shadow. Use a Hairline border or a tone step instead.

## Shapes

Soft and friendly: every corner is gently rounded, nothing is sharp and nothing is a full pill except counts and tags. The base radius is 10px (`--radius`).

- Buttons, inputs, textareas and the inset panel: 10px (`rounded-lg`).
- Sidebar rows and menu items: 8px and 6px (`rounded-md`), so they nest inside their container's curve.
- Dialogs and the sign-in card: 14px (`rounded-xl`).
- Tags, badges, counts, radios and avatars' fallbacks: fully rounded, except the avatar in the top bar, which is an 8px-rounded square.

## Components

### Buttons
Soft, compact and plain.
- **Shape:** 10px corners, 32px tall (40px on a phone), 12px side padding, 14px medium text.
- **Primary:** Ink Indigo with white text. At most one per view: the main action of a form or dialog.
- **Outline:** white with a Hairline border. Cancel, "Back to your Channels", secondary actions.
- **Ghost:** no fill until hover.
- **Chrome:** the ghost button for the dark top bar (sidebar toggle, phone search): chrome text at 80%, with a 10% tint of the chrome text colour on hover.
- **Destructive:** a pale red wash with red text, never solid red.
- **Hover / Focus:** hover dims the fill slightly. Focus shows a 3px ring at 30% of the ring colour. A pending button reads "Creating…" or "Signing in…" and is disabled.

### Chips and tags
- **Tag** (Badge, `variant="tag"`): a pill with a Hairline border and Slate Muted 12px text, such as "Private" with a lock icon in the Channel bar. Later: "Archived", "Deactivated".
- **Ping count** (Badge `variant="ping"`, or SidebarMenuBadge at the end of a sidebar row): a solid Ping Pink pill with white 12px bold tabular numbers.
- **Saved** (Badge `variant="saved"`): Saved Green text in a pill with a faint green border.

### Cards / Containers
- **Inset panel:** 10px corners, Feed Mist behind content, no shadow.
- **Choice card:** a radio option in a dialog (Create channel's Public and Private) is a bordered card that tints when checked. Clicking anywhere on the card selects it.
- **Dialog:** Panel White, 14px corners, 24px padding, an 18px bold title, actions bottom-right with Cancel before the primary action.

### Inputs / Fields
- **Style:** white with a Field Edge border and a faint shadow, 10px corners, 32px tall. The label sits above in 14px medium.
- **Focus:** the border turns Ink Indigo and a soft 3px ring appears.
- **Error:** the border and label turn Alarm Red and the message appears under the field, announced. A failure no field explains (the network, a refusal) shows as a pale red box above the actions.
- **Building one:** use the bound fields in `apps/web/src/components/form.tsx`, which apply these states, the error wiring and focus. The rules are in `docs/conventions.md` › The web app › Forms (ADR 0008).

### Navigation
- **Sidebar rows:** 28px tall (40px on a phone), 8px corners, a 16px icon at 80% then the name, truncated. Hover is one navy step lighter. The current Channel is a solid Sidebar Active row with white text.
- **Section labels:** 13px medium Sidebar Muted, such as "Channels".
- **Tabs (Channel bar):** 13px semibold, the current tab underlined 2px in Ink Indigo.
- **Avatar menu:** the avatar opens a menu with the name and email, Edit profile (a dialog for the display name and email), the theme choice (System, Light, Dark) and Sign out. Arrow keys move through it.

### Toasts
Short confirmations and failures ("Thread Saved", "Can't reach Ping. Try again.") use Base UI's Toast from the shadcn base registry, not Sonner. The first slice that needs one installs it.

### Top bar
44px of ink navy chrome: the sidebar toggle (laptop), the Ping wordmark, a centred search field tinted 10% with the chrome text colour (behind an icon on a phone), and the avatar on the right.

## Do's and Don'ts

### Do:
- **Do** build from `apps/web/src/components/ui` and the tokens in `apps/web/src/index.css`. Add a missing piece with `pnpm dlx shadcn@4.23.0 add <name>` from `apps/web`, then adapt it to these rules.
- **Do** use semantic utilities (`bg-primary`, `text-muted-foreground`, `bg-ping`, `text-saved`, `bg-sidebar`), never raw colours like `bg-blue-500`.
- **Do** check every new text pair for 4.5:1 contrast in both themes, and check new screens at laptop and phone width.
- **Do** compose: compound components and explicit variants, `children` over render props (`.claude/skills/vercel-composition-patterns`).
- **Do** use lucide-react icons at 16px, decorative (`aria-hidden`), with the meaning in text or an accessible name.

### Don't:
- **Don't** add per-feature CSS files or `@apply` in components. `index.css` holds tokens and base styles only.
- **Don't** use Ping Pink, Saved Green or Alarm Red for anything but their one meaning (The Signal Rule).
- **Don't** add shadows to in-flow surfaces like Thread rows or the Channel bar (The Flat-By-Default Rule).
- **Don't** add a boolean prop that switches a component's mode. Make an explicit variant or a separate component.
- **Don't** load fonts, icons or scripts from a CDN: the CSP allows only this origin, and no Staff member's data goes to a third party.
- **Don't** use gradients, glows, blur or purple-to-pink decoration.
