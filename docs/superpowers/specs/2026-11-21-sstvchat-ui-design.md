# SSTV Chat — UI design (phase 1: interface only)

Date: 2026-11-21

## Intent and why

A hackathon project: a web app that looks and feels like Snapchat, except the
transport is radio-style audio. **Images (snaps) are sent and received as SSTV**,
and **text chats are sent as two-tone digital (FSK)**. There are no video or
voice calls.

This phase is **only the user interface**. It must look as close to 1:1 with the
reference screenshots as possible, driven by mock data, so the real SSTV / FSK
transport can be wired in later without reworking the UI.

## Reference screenshots

Local only (gitignored, they contain third-party art and private names):

- `docs/reference/desktop-chat.png` — Snapchat for Web, light theme, 2536×1413 (2× of ~1268×706 CSS px)
- `docs/reference/mobile-chat-list.png` — iOS app Chat tab, dark theme, 1284×2778 (3× of 428×926 CSS px)
- `docs/reference/mobile-camera.png` — iOS app Camera tab, dark theme, same size

All pixel values below are approximate CSS px measured from those images; the
builder should re-measure against the references when tuning.

## Theme (user decision)

**Theme follows the system** (`prefers-color-scheme`) on both desktop and mobile.
The desktop reference shows the light values, the mobile reference the dark
values; derive the missing pair (desktop dark ≈ mobile dark colours, mobile light
≈ desktop light colours). Camera and snap viewer are always black.

## Goals

1. Desktop (≥ 768 px wide): layout and styling matching `desktop-chat.png` (light shown; dark derived).
2. Mobile (< 768 px wide): matching `mobile-chat-list.png` and `mobile-camera.png` (dark shown; light derived).
3. The screens you naturally tap into next on mobile (conversation, Send To, snap viewer) exist and look like they belong to the same app.
4. SSTV / two-tone states are visible in the UI, simulated with timers.
5. Mock data and simulated transport are isolated so they can be swapped for real logic later.

## Non-goals (this phase)

- Accounts, login, auth, profiles, settings, backends, persistence.
- Real SSTV encoding/decoding, real FSK modem, audio I/O.
- Webcam access — the camera viewfinder is black, like the reference.
- Video or voice calls of any kind.
- Content for Map, Stories and Spotlight tabs (they open to an empty placeholder).

## Anti-goals

- **Copying Snapchat's ghost logo or Bitmoji avatars.** Use an original logo mark
  and original cartoon avatars in the same round style. Do not reproduce the ghost
  silhouette or Bitmoji art; do not trace them.
- A UI that reads as "inspired by" rather than matching the layout, spacing,
  colours, type sizes and icon weights of the references.
- Scope creep into transport/accounts.

## Constraints

- Repo is empty except README/LICENSE. WebStorm project.
- Must run with `npm install && npm run dev`.
- Emoji render with the system emoji font (Segoe on Windows) — acceptable.
- Reference font is Avenir Next–like. Use the stack
  `"Avenir Next", Avenir, "Nunito Sans", system-ui, sans-serif` with Nunito Sans
  bundled locally (e.g. `@fontsource/nunito-sans`), so Mac shows Avenir and Windows
  shows Nunito Sans. No runtime calls to third-party CDNs.

## Approaches

1. **Vite + React + TypeScript, plain CSS (picked).** Component model suits many
   repeated rows/bubbles and the later swap from mock to real transport; fast dev
   server; no server features needed.
2. Plain HTML/CSS/JS. Fastest to start, but state (selected chat, transmit
   progress, screens) and later transport wiring get messy quickly.
3. Next.js. Adds routing/SSR/server pieces the project doesn't need; slower to
   iterate for a pure client-side UI.

The user handed over the "how"; approach 1 is the builder-facing decision.

## Layout — desktop (≥ 768 px), light theme

Three regions, white page background (`#FFFFFF`).

```
┌──────────────┬───────────────────────────┬────────────────────────┐
│ sidebar      │ conversation card         │ right pane (only when  │
│ ~309px       │ fills remaining width     │ camera or a snap is    │
│              │                           │ open), ~456px          │
└──────────────┴───────────────────────────┴────────────────────────┘
```

- **Right pane is hidden by default.** It opens only when the user clicks a
  camera button (camera icon in the "Send a chat" bar) or opens a received snap.
  While hidden, the conversation card takes the space. The pane has a close
  control; Esc closes it.

### Sidebar (left, ~309 px, 1 px right border `#E6E6E6`)

- Header (~60 px): own avatar (~44 px) with a small gear badge bottom-right;
  centred **original** logo mark (outline, grey `#BFBFBF`, ~30 px — e.g. a
  rounded blob with an antenna and a sine-wave mouth; must not resemble the
  Snapchat ghost); right: blue (`#0FADFF`) circular compose button (~36 px) with
  white chat-bubble+pencil glyph. Compose opens a simple "New Chat" friend list
  (low priority; can be a basic popover).
- Search pill: full width minus ~10 px margins, ~36 px tall, 1 px border
  `#D6D6D6`, magnifier icon, placeholder "Search". Filters the list by name.
- Separator line below search, full width.
- Chat rows (~72 px tall, 1 px separators `#EBEBEB`):
  - Avatar ~48 px circle on light grey (`#EFEFEF`) background. Optional ring
    (story/active), optional emoji badge bottom-left (e.g. 😊), groups show 2–3
    overlapping faces.
  - Name (~16 px, regular, `#16191C`), may include emoji.
  - Status line (~12–13 px): icon + status word (coloured) + ` · time` + optional
    ` · 29🔥` streak, in grey `#6E6E6E` except the status word when coloured.
  - Optional right-side indicator: filled rounded square (new snap) or filled chat
    bubble (new chat), ~16 px, in the status colour.
  - Hover and selected rows: background `#F2F2F2`.

### Status semantics (shared by desktop and mobile)

Colours: **chat = blue `#0FADFF`**, **snap = red `#F23C57`** (snaps are images only; user decision —
`#F23C57` for a snap variant), **live/receiving = green `#00C67F`**.

| Status            | Icon                        | Text colour |
|-------------------|-----------------------------|-------------|
| New Snap          | filled square               | red         |
| New Chat          | filled chat bubble          | blue        |
| Delivered         | filled arrow                | grey text, icon in type colour |
| Opened            | outline arrow               | grey text, icon in type colour |
| Received          | outline square / bubble     | grey        |
| Screenshot        | crossed-arrows icon         | grey text, blue icon |
| **Transmitting · 34%** (new) | animated filled arrow | type colour; % updates |
| **Receiving · 62%** (new)    | animated waveform icon | green (replaces reference "Call Active") |

### Conversation card (middle)

- Header row outside the card (~60 px): round grey back button (~36 px, `#F0F0F0`,
  chevron), group/friend avatar (~40 px), name (~18 px semibold). **No Call
  buttons.**
- Card: 1 px border `#E3E3E3`, radius ~10 px, white, fills remaining height with
  ~12 px gutters.
- Messages (group style from the reference), top to bottom:
  - Sender label: uppercase, ~12 px, bold, letter-spaced, colour per person
    (ME = red `#F23C57`; others from a palette: blue `#0FADFF`, pink `#F23C57`-ish,
    green `#3CB371`, purple `#A05DCD`).
  - Body: ~16 px text, preceded by a 2–3 px vertical bar in the sender colour,
    spanning consecutive lines from that sender.
  - Emoji-only messages render large (~40 px).
  - Quoted reply: a bordered rounded card (border `#E8E8E8`) containing the quoted
    sender label, a timestamp right-aligned (`4:37PM`, ~11 px grey), and the quoted
    text with its own sender bar; the reply text follows below.
  - Sticker message: large emoji/sticker (original art or emoji, ~48 px).
  - **Snap message in chat**: a tile showing "📷 Snap" style row (red) that, when
    clicked, opens the right pane in snap-viewer mode.
  - **Outgoing text sending state**: a just-sent message shows a small grey
    "Sending…" label under it for ~1–2 s (simulated two-tone transmit), then clears.
- Presence chips just above the input: small pills with the member's name in their
  colour on a tinted background, each with the member's avatar peeking above the
  pill (head cropped). One chip may show a laptop icon (on web).
- Input: pill ~36 px tall, 1 px border `#E3E3E3`, camera icon left (opens right
  pane camera), placeholder "Send a chat". Enter sends (appends to mock thread).

### Right pane (desktop)

Header row like the reference's right column: small round grey chat-bubble button
on the left (closes pane), avatar + name of the current conversation, and a pill
button on the right ("Close" in neutral grey, or "Stop" in red `#F23C57` while
a transmission is running — same shape as the reference "Hang up" pill).

Body: a rounded card (~10 px radius) in one of these modes:

1. **Camera**: black viewfinder; shutter ring (~64 px, white 5 px ring) bottom
   centre; small tool rail top-right (flip, flash, chevron). Shutter → **Preview**
   showing a bundled placeholder image (original art; e.g. an SSTV-style test card
   or simple illustrated scene), with "Send To" button bottom-right (blue pill with
   arrow). Send To → recipient list (checkbox rows, current chat preselected) →
   Send. The pane closes; the recipient row(s) show "Transmitting · N%" until 100 %,
   then "Delivered · now".
2. **Snap viewer (receiving)**: the portrait snap paints **left to right, one
   column at a time** (see Snap format), with a bright 1–2 px vertical scan line at
   the paint front. Overlay header: sender, time,
   and readout like `Robot36 · 62% · 0:22`. When finished the readout shows
   `Robot36 · received`; closing marks the row "Opened".

## Layout — mobile (< 768 px), dark theme

Page background `#121212` (chat list) / `#000000` (camera). Text white; secondary
`#8E8E93`-ish. Fixed bottom nav on all mobile screens.

**Device chrome (builder's call):** don't draw a fake iOS status bar. Use
`viewport-fit=cover` and `env(safe-area-inset-*)` padding so it fits a real phone
(Safari or saved to the home screen) and still looks right in a desktop browser
at phone width, where the insets are 0. The reference's top ~47 px (status bar)
and bottom home-indicator strip are device chrome, not app UI.

### Bottom nav (~84 px incl. safe area, background `#1C1C1E`-ish)

Five icons, evenly spaced, ~28 px, white outline: map pin, chat bubble, camera,
two-people (stories), play triangle (spotlight). The current tab's icon is
**filled**. No labels.

### Chat list (mobile)

- Top bar (~64 px): own avatar (~40 px circle on `#2C2C2E`), round search button
  (`#2C2C2E`, ~40 px), centred title "Chat" (~22 px bold), bell button, yellow
  (`#FFFC00`) add-friend button with red badge "5", more (•••) button.
- Horizontal scroll chip row: `[avatar] My AI`, `Flashbacks (4)` (white count
  badge), `Groups`, `Near me`, `Best Friends`. Bold ~16 px white, no chip
  backgrounds. Non-functional except visual.
- Rows (~60 px, no separators): avatar ~46 px, name ~18 px white, status ~14 px
  grey with status icon (same semantics/colours as desktop), right-aligned camera
  outline icon (~24 px) that opens Camera addressed to that friend. One row may
  have a "Watch" pill (dark grey, history icon) instead of the camera icon.
- Yellow compose FAB (~60 px) bottom-right above the nav (chat-bubble+pencil glyph,
  black).
- Tap a row → mobile conversation. Tap a row with a New Snap → snap viewer.

### Camera (mobile)

Matches `mobile-camera.png`:

- Black viewfinder full screen.
- Top-left: own avatar, search icon (no background). Top-right: bell, add-friend
  with red "5" badge, flip-camera icon.
- Right tool rail under it: flash-off, music note, record-mode (circle-square),
  chevron-down inside an outlined circle.
- Zoom pill above shutter: `.5  1x  2.5`, selected `1x` in yellow on a darker
  circle.
- Shutter ring (~80 px, ~6 px white ring) centred; memories icon to its left;
  lens carousel circles to its right (**original** placeholder lens art — gradient
  or simple icons, not faces/photos).
- Below: game-controller icon left, lens category tabs ("Favourites",
  **"Create with AI"** selected with outline pill, "Aesthetic", …) scrolling, and a
  smiley-with-sparkle icon right.
- Shutter → Preview (placeholder image) → Send To → back to Chat list with
  "Transmitting · N%" on recipients.

### Mobile conversation (not in references — builder designs in the same language)

Dark version of the desktop conversation: header with back chevron, avatar, name;
same sender labels / colour bars / quote cards; presence chips; bottom input bar
with round camera button, "Send a chat" pill, and mic/sticker icons on the right.

### Snap viewer (mobile)

Full screen black, the 3:4 snap fitted to the screen width and vertically
centred, same left-to-right column paint and readout as desktop; tap or swipe
down to close.

### Map / Stories / Spotlight

Empty dark screen with the tab name centred; bottom nav works.

## Mock data

One shared dataset (`src/data/mock.ts`) used by both layouts, based on the desktop
reference's fictional names, plus a few extra rows so the mobile list scrolls:

- Beatriz M — Receiving · 62% (animated) — has an incoming snap
- 💎Julie💎 — New Snap · 16m · 29🔥
- Roomies (group: Sophie, Ben, Jen, me) — Opened · 1h — **selected by default on
  desktop**; thread content mirrors the reference conversation (flight / airport
  messages, emoji reply, quoted reply, "Catch ya later", sticker)
- Starfish Squad ✨ — New Chat · 16m
- Moe S (😊 badge) — Delivered · 25m · 29🔥
- Andy G — Screenshot · 1h
- Callum B — Opened · 1h
- Jess Alan — Opened · 1h
- 4–6 more invented names for mobile scroll (do **not** use the names visible in
  the mobile reference screenshot; they are real people).

## Avatars

Original procedurally drawn SVG cartoon faces (head shape, skin tone, hair
style/colour, eyes, mouth, shirt colour) seeded per contact, rendered inside a
circle. Desktop circle background light grey; mobile dark grey. Group avatar
composes 2–3 faces. Must not imitate Bitmoji's style closely enough to be
confused with it.

## Snap format (user decision: always portrait)

- A snap is **always portrait, 3:4, 240×320 px** (decided by the user).
- For transmission it is **rotated 90° clockwise** into a standard 4:3
  landscape SSTV frame (Robot36, 320×240), and rotated back on receipt. Any
  regular SSTV app can still decode it (it just shows sideways).
- Consequence: each SSTV line received is one **column** of the portrait image,
  so the receive animation fills the picture **left to right**.
- Camera viewfinder and Preview are framed 3:4: on desktop the right-pane card is
  3:4 (≈ 456×608); on mobile the viewfinder stays full screen black and the
  captured/received snap is shown fitted to width, centred, with black above and
  below.
- Placeholder snap art is portrait 3:4 too.

## Simulated transport (UI only)

A small module (e.g. `src/sim/transport.ts`) that exposes the shape the real
transport will later use. It is a **proposal** (builder's call, flagged to the
user): whoever builds the real modem may change it, but the UI should consume it
only through this module.

**Radio model (builder's call):** one shared, half-duplex channel. Only one
transmission is on air at a time, and you can't send while receiving. Radio is
broadcast, so a snap to several friends goes out **once**, with all recipients
showing the same progress. Anything sent while the channel is busy waits with a
**"Queued"** status (grey, outline arrow) and starts automatically.

**Interface sketch:**

- `sendText(chatId, text)` → transmission handle.
- `sendSnap(chatIds, image: ImageData)` → transmission handle.
- `cancel(handle)` — used by the red "Stop" pill. A cancelled receive keeps the
  partly painted image and shows `Robot36 · stopped`; a cancelled send marks rows
  "Failed" (grey, tap to retry is out of scope).
- Events:
  - `tx:progress` / `tx:done` (handle, 0–1)
  - `rx:start` (from, kind: `snap` | `text`, mode)
  - `rx:row` (row index 0–239, 320-px pixel row of the landscape SSTV frame as
    `Uint8ClampedArray`), **snap only**: the viewer rotates each row back into
    column `index` of the 240×320 portrait `<canvas>`, so swapping in a real
    decoder needs no viewer changes. The mock produces rows by rotating and
    slicing a bundled portrait image.
  - `rx:text-chunk` (characters decoded so far), **text only**.
  - `rx:done` / `rx:cancelled`.

**Incoming text UI (builder's call):** while a text is being received, the chat
row shows `Receiving…` (blue, animated waveform icon) and the open thread shows
the incoming message typing itself out character by character in the sender's
colour, with a small grey `Receiving · two-tone` label under it.

**Timing:** Text ~1.5 s per short message. Snap transmit/receive is compressed to
~8–10 s for the demo, labelled with a real mode name (`Robot36`; real airtime
36 s). Duration is one constant.

**Demo controls (builder's call):** nothing arrives on its own after page load,
because a receive that starts at load is over before anyone looks. Pressing
<kbd>Shift</kbd>+<kbd>D</kbd> toggles a small floating panel with "Incoming snap
from…", "Incoming text from…" and "Reset demo" buttons. Initial state still shows
Beatriz's row as a paused `Receiving · 62%` mid-transfer that resumes when the
user opens it.

## Code organisation (builder may adjust)

```
src/
  main.tsx, App.tsx            breakpoint switch (matchMedia 768px)
  styles/tokens.css            colours, radii, font stack, light/dark sets
  data/mock.ts                 contacts, threads
  sim/transport.ts             fake send/receive with progress
  components/                  Avatar, Icon set, StatusLine, ChatRow, Message…
  desktop/                     Sidebar, Conversation, RightPane (Camera, Viewer)
  mobile/                      ChatList, Camera, Conversation, SendTo, Viewer, BottomNav
```

Icons: hand-authored inline SVGs tuned to the references' stroke weight
(lucide-react may be used as a base where shapes match).

## Verification

Screenshot the running app with Playwright at 1268×706 (desktop) and 428×926
(mobile) and compare side-by-side with the references; iterate on spacing, sizes
and colours until they line up. Check: right pane hidden by default and opens only
from camera buttons / snaps; transmit and receive animations run and finish;
mobile tabs switch; no horizontal scroll at 375 px.

## Left to the builder

- Exact pixel tuning against the references.
- Original logo mark and avatar generator design (within the anti-goals).
- Placeholder snap image art.
- Mobile conversation and Send To screen details.
- State management (React state/context is enough), whether to use hash routing
  for mobile screens.
