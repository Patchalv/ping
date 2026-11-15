# The web app is built with shadcn/ui on Base UI and Tailwind CSS

**Status:** accepted

The exemplar slice (#31) styled the shell with one hand-written `styles.css`, a native `<dialog>`, a custom avatar menu and inline SVG icons. That was a default, not a decision. The next slices need the hardest UI in Ping: the Mention picker, the Section picker, list controls, toasts and a resizable Thread panel, all usable from the keyboard (`docs/spec/screens.md` › Baseline behaviours). Building each of those by hand would be slow and hard to make accessible. #65 settled the stack before the Threads slice (#38) copies it.

## Decision

- **shadcn/ui, with Base UI primitives and the Rhea style.** Components are copied into `apps/web/src/components/ui/` by the shadcn CLI (`components.json`) and are Ping's own code from then on. Base UI is shadcn's default since July 2026, released monthly, and ships its own Toast, so one primitive family covers menus, dialogs, popovers, tooltips and toasts. Rhea is shadcn's compact style, the closest to the density Ping wants.
- **Tailwind CSS v4** through `@tailwindcss/vite`. Components style themselves with utilities. `apps/web/src/index.css` holds the tokens (`:root` and `.dark`), the type scale and the base styles. Beside it, `shadcn.css` is vendored from the shadcn package (its data-attribute variants and animations), so the app doesn't depend on the shadcn CLI package, whose transitive dependencies failed `pnpm audit`. No per-feature CSS files and no `@apply` in components.
- **lucide-react** for icons, and **Figtree** (self-hosted with `@fontsource-variable`) for type. Nothing loads from a font CDN, so no Staff member's IP address goes to a third party.
- **Light and dark themes.** The Staff member picks System, Light or Dark in the avatar menu, kept in `localStorage`. `public/theme-init.js` applies the choice before first paint (the CSP allows no inline script). `lib/theme.ts` is a small external store read with `useSyncExternalStore`, so it needs no context and no effect.
- **The Sidebar is shadcn's, adapted** (`components/ui/sidebar.tsx`): it sits in the page flow under the top bar, it is the home screen on a phone instead of a slide-out sheet, it can be resized by dragging or with the arrow keys, and ⌘B or Ctrl+B hides it. Its open state and width are kept in `localStorage`, not shadcn's cookie.
- **`SidebarProvider` is an allowed exception to "no data in React context" (ADR 0006).** It holds UI state only (open and width) for the sidebar's compound components. Server data still never goes into context.
- **Components follow Vercel's composition patterns** (`.claude/skills/vercel-composition-patterns`): compound components, explicit variants, `children` over render props, and no boolean props that switch a component's mode. The generated `showCloseButton` and `inset` props were removed for that reason.
- **`#/` points at `src/`**, a `package.json#imports` subpath, so Vite, Vitest and dependency-cruiser resolve it without extra config (dependency-cruiser could not resolve a `@/` alias, so the feature-boundary rule would have stopped seeing those imports). TypeScript reads the same mapping from `paths` in `apps/web/tsconfig.json`.
- **`cn` comes from `#/lib/utils`**, built with `createCn` from the `cn` package and taught the custom `text-small` step. The package's default `cn` mistakes `text-small` for a colour and drops it.
- `DESIGN.md` describes the visual system: colour roles, type, spacing and components. `docs/conventions.md` points to it.

## Consequences

- Every slice that touches `apps/web` builds from `components/ui` and the tokens, and adds missing components with `pnpm dlx shadcn@4.23.0 add <name>` from `apps/web`, then lints the generated file.
- Biome parses Tailwind's CSS directives (`css.parser.tailwindDirectives`). Its Tailwind class sorting rule is still in nursery, so it stays off.
- Knip ignores unused exports in `components/ui/`, because a component library exports more than one screen uses.
- The style props set through React (the sidebar width) and Base UI's positioning use the CSSOM, which the strict `style-src 'self'` CSP allows. A component that injects a `<style>` element would be blocked, so check new ones in the built app.

## Considered options

- **Plain CSS only:** rejected. Accessible menus, popovers, comboboxes and toasts would all be hand-built, and each slice would add one-off CSS.
- **Radix primitives with plain CSS:** rejected. It solves accessibility, but every component still needs its own styling, and Radix is maintained more slowly than Base UI.
- **shadcn/ui on Radix:** not chosen. It's the older path with more examples online, but Base UI is shadcn's default, so the docs and `shadcn add` match it without flags.
- **shadcn's Sidebar unchanged:** rejected. Its fixed position assumes no top bar, and its phone sheet contradicts screens.md, where the sidebar is the home screen.
- **Sonner for toasts:** not chosen. Base UI's Toast keeps one primitive family. It's installed by the first slice that needs a toast.
