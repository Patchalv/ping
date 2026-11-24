# Screens

Ping uses a channel-first layout modelled on Slack: prototype variant **B2** in `prototypes/ping-screens/index.html` on the throwaway branch [`prototype/ping-screens`](https://github.com/Patchalv/ping/tree/prototype/ping-screens/prototypes/ping-screens). Open that file for the look; this page is the written contract. Variants A, B and C on the same branch are for reference only.

Product principles behind the layout: clearing Pings and working through Saved on a laptop takes as few steps as possible, and a Thread can be read and answered from a phone without effort.

## Laptop

### Top bar

- Dark, across the full width.
- A button on the left hides or shows the sidebar (also ⌘B or Ctrl+B, except while typing in a text field).
- The Ping logo (the mark and "Ping") is a link to Home, `/`. The Staging badge beside it is not part of the link.
- The search bar sits in the centre (see [Search](#search)).
- The Staff member's avatar sits on the right. It opens their profile (display name and email), the theme (System, Light or Dark, kept in this browser), sign-out, and for Admins the Admin screens.

The main area is a white panel inset on the dark chrome, with rounded corners. `DESIGN.md` has the visual system.

### Sidebar

Dark, on the left, from top to bottom:

1. **Pings**, with a badge counting the Threads that have a Ping for you, and **Saved**. Each opens a list in the main area, like Slack's Activity view.
2. The Staff member's own **Sections**, in their chosen order, then the default **Channels** section.
3. **+ New section**, **Browse channels** and **Create channel**.

Rules:

- The sidebar lists only Channels you're a member of. Public channels you haven't joined are reached through search or Browse channels, which lists every Public channel with a Join button. This keeps the sidebar usable with hundreds of Channels.
- A Channel with Pings shows in bold with a count. A muted Channel's count is grey.
- A Private channel shows a lock icon.
- Sections are personal: you create, name, reorder and collapse your own, and nobody else sees them. A collapsed Section still shows any of its Channels that have Pings.
- Channels move between Sections by drag and drop in the sidebar. Channels you haven't placed, including ones you've just joined, sit in the default Channels section.
- The Staff member can drag the sidebar's right edge to make it wider or narrower (200 to 420px), or focus the edge and use the arrow keys. The width is kept in this browser.

### Channel view

A white **Channel bar** sits above a grey feed of Thread rows.

The Channel bar has:

- the name (with a lock icon if Private), the member count, a Mute toggle, **+ New Thread** and **Settings**;
- an Archived notice, when the Channel is Archived;
- **Threads** and **Members** tabs, with the Thread list controls at the far right on the Threads tab: Status (Open, Resolved, All), Pings (All, With Pings), sort (Latest activity or Date started) and direction, with an "N Resolved hidden" note. They wrap under the tabs when the bar is narrow.

A Staff member viewing a Public channel they haven't joined sees a **Join** button in place of + New Thread.

**Settings** opens the Channel settings dialog for everyone who can read the Channel. It shows the name, the description, "Who can resolve threads?" and the visibility. Channel admins change them there; everyone else, and everyone in an Archived channel, reads them only. A bottom section holds Archive or Unarchive, for whoever may, and Leave, for members. Archive and Leave ask first; Unarchive happens at once. Channel admins manage members from the Members tab.

Each **Thread row** is a white card showing:

- the author and time;
- the title and a preview of the description;
- the first Attachments;
- "N Thread Responses · N new";
- a Saved marker and an "@You" marker when they apply;
- inline Acknowledge buttons at the top right: ✓ mark read, 👍 react, 🔖 Save.

A System thread row is styled as coming from Ping, not from a person. A Deactivated author shows greyed with a "Deactivated" label.

The **Members** tab lists members, marks Channel admins, and shows Deactivated members greyed with their label.

### Thread view

- Opens as a side panel on the right of the Channel view. The Staff member can resize it like the sidebar, by dragging its edge or with the arrow keys, and the width is kept in this browser.
- Its header holds the Acknowledge buttons (mark read, react, Save) and Resolve or reopen when allowed.
- Then the Thread itself, its Thread Responses, a "N new" divider above the Thread Responses that are new since you last Acknowledged, and the composer at the bottom.
- Opening a Thread never clears its Ping.
- Placeholders: "Thread Response deleted" and "Attachment removed by <name>".
- Edited content shows "edited", or "edited by <name>" when someone other than the author edited it.

### Home

The main area at `/` shows two tiles side by side: how many Threads have a Ping for you, and how many Threads you've Saved. Each tile is a large number in its signal colour (pink for Pings, green for Saved), with what it counts under it and the view's name, and opens the Pings or Saved view.

- At zero, the number is grey: Pings reads "You're all caught up", and Saved suggests saving a Thread to come back to it.
- While loading, each tile keeps its size, so nothing moves when the numbers arrive. A failed load shows the error in the tile with **Try again**.
- The numbers update live as Pings arrive and Threads are Saved or removed from Saved.

### Pings and Saved views

These use the same Thread rows as the Channel feed, with the Channel name on each row. Pings are ordered by their latest activity and Saved by when each Thread was saved, newest first.

### Composer

- A TipTap editor with the allowed formatting only: headings, bold, italic, underline, strikethrough, inline code, code blocks, bullet and numbered lists, blockquotes, links, Mentions (@) and emoji.
- A new Thread has a title and a description.
- Attachments can be added while writing, with upload progress shown before sending. Images show inline previews and other files show as chips.

### Admin screens

Reached from the avatar menu, for Admins only:

- **Staff members:** everyone with their role and state. Invited people show Resend and Cancel (and "Expired, Resend" or "Email not sent, Resend" when those apply). Actions: invite, change role, Deactivate, reactivate.

## Phone

- The home screen is the sidebar (Pings, Saved and Sections) under the dark top bar, with search behind an icon.
- Tapping a Channel shows its Channel bar and Thread list. The Acknowledge buttons sit under each row, within thumb reach.
- Tapping a Thread opens it full screen, with the composer at the bottom.
- Channels can't move between Sections on a phone, because that's done by drag and drop.

## Search

- One search bar, always visible on laptop (behind an icon on phone).

**The search dialog**

- Clicking or typing in the search bar, ⌘K or Ctrl+K, or `/` (when focus isn't in a text field) opens a dialog anchored to the top bar. The Channel or Thread you were in stays open underneath, and opening, typing in and closing the dialog never changes the route. On a phone, the search icon opens the same dialog as a full-screen sheet.
- Esc or clicking outside closes it, and focus returns to the search bar. It reopens with your last text selected, so typing replaces it and Enter re-runs it; a page reload clears it.
- With nothing typed it shows only the input and the key hints (↵ all results, esc close). It has no filter chips.
- About 150 ms after the last key it shows, in order: **All results for "X"** (↵, highlighted by default); **Only in #channel** (⇧↵), only when opened from a Channel or one of its Threads, and while it's highlighted the list shows only that Channel's Threads; up to 3 **Channels**; and up to 5 **Threads**. The previous results stay until the new ones arrive, with a spinner in the input.
- A Thread row shows its title, `#channel` and a muted "Resolved" when it applies. A Channel row shows `#name`, a lock for Private and an "Archived" badge. Matched words are marked in Thread titles only; there are no snippets.
- When nothing matches, the two action rows stay, with "No Channels or Threads match" below them.
- The arrow keys move between rows, and Enter opens the highlighted one. A Channel row opens the Channel; a Thread row opens the Thread, scrolled to the matched Thread Response. Back returns to where you were.

**The search screen**

- **All results**, or Enter, opens the search screen (`/search?q=…`) as a new history entry. **Only in #channel** opens it with In set to that Channel, on the Threads tab, with Status All.
- Browser Back, or the × on the screen, returns to the Channel or Thread you came from (Home when there is none). Typing, tabs and chips on the screen replace the history entry, and on the screen itself the search bar edits its text in place, with no dialog.
- Filter chips: **In: #channel** (suggested when you came from a Channel), **From: person**, and **Status** (All by default, Open, Resolved).
- Results have **All**, **Channels** and **Threads** tabs. Archived channels carry an "Archived" badge. Opening a Thread Response match scrolls to that Thread Response.

The rules behind search are in [product.md](product.md#search).

## Baseline behaviours

- **Long lists.** A Thread list (a Channel feed, Pings, Saved or search results) loads 50 Threads at a time, with **Load more**. An open Thread loads all its Thread Responses.
- **Drafts.** The composer keeps an unsent draft in the browser, one per Thread and one per Channel for a new Thread, until it's sent or cleared.
- **Browsers.** Ping supports the latest two versions of Chrome, Safari, Firefox and Edge.
- **Accessibility.** Every action works from the keyboard, and text meets WCAG AA contrast.

Source: the [plan review](README.md#changes-from-the-plan-review).

## Other flows

- **Sign-in**, **forgot password** and **set password** (from an invite or reset link) pages.
- **Accepting an invite** lands the new Staff member on **Browse channels**.
- **Create channel:** name, description and visibility.
- **Changing your email** sends a link to the new address, and the change takes effect when you open it.
- **Leaving as the last active Channel admin** is stopped with an explanation (see [product.md](product.md#members-and-channel-admins)).
- **Deleting a Thread that has other people's Thread Responses** asks for confirmation and says how many Thread Responses will be deleted.

Source: [How should Ping's inbox, Channel and Thread screens look on laptop and phone?](https://github.com/Patchalv/ping/issues/8#issuecomment-6862576413)
