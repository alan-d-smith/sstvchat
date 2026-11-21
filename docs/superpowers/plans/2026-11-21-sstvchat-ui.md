# SSTV Chat UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Snapchat-style web UI (desktop 3-pane + mobile tabs) driven by mock data and a simulated SSTV / two-tone transport.

**Architecture:** Vite + React + TypeScript SPA. One React context store owns chats, navigation and transmissions and listens to a mock transport (timer-driven, half-duplex queue). Desktop and mobile are separate component trees chosen by a 768 px media query; they share types, data, avatars, icons, status line, thread rendering and the snap canvas.

**Tech Stack:** Vite 6, React 18, TypeScript 5, plain CSS (custom properties), Vitest + @testing-library/react + jsdom, @fontsource/nunito-sans, Playwright CLI for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-21-sstvchat-ui-design.md` (read it; pixel values, colours and copy come from there). References: `docs/reference/*.png`.

## Global Constraints

- Theme follows the system via `prefers-color-scheme`; every colour comes from `src/styles/tokens.css` variables with light and dark sets. Camera and snap viewer are always black.
- Breakpoint: `(max-width: 767px)` = mobile tree, otherwise desktop tree.
- Font stack: `"Avenir Next", Avenir, "Nunito Sans", system-ui, sans-serif`; Nunito Sans bundled via `@fontsource/nunito-sans` (400/600/700). No runtime CDN requests.
- **No Snapchat ghost logo, no Bitmoji-like art, no traced assets.** Logo, avatars, lens circles and snap placeholders are original.
- No real names from `docs/reference/mobile-chat-list.png`.
- Snaps are always portrait 240×320; transmitted as Robot36 320×240 rotated 90° CW.
- Commit messages: single line, `feat(scope): …` / `fix(scope): …` / `chore(scope): …`, no body, no co-author trailer.
- Work on branch `feat/ui`.

## Review Focus

1. Sending while the channel is busy (receiving or another send) → item shows `Queued`, starts automatically afterwards. Test in Task 2.
2. Cancelling a receive halfway → partial image stays, readout `Robot36 · stopped`, no further `rx:row`. Test in Task 2.
3. Multi-recipient snap → one transmission, every recipient row shows the same progress, all become `Delivered`. Test in Task 4.
4. Opening the camera/snap pane on narrow desktop widths (768–1100 px) → no horizontal page scroll; conversation shrinks (min 320 px). Checked in Task 10 screenshots at 900 px.
5. Long names / long messages → ellipsis in rows, wrapping in thread, no layout break. Mock data includes one long name (Task 1); checked in Task 10.

## File Structure

```
index.html                     viewport-fit=cover meta, #root
src/main.tsx                   fonts + tokens import, <App/>
src/App.tsx                    useIsMobile() → <DesktopApp/> | <MobileApp/>, <DemoPanel/>
src/hooks/useIsMobile.ts
src/styles/tokens.css          colour/size tokens, light + dark
src/types.ts                   domain types (below)
src/data/mock.ts               people, chats, threads
src/sim/rotate.ts              portrait↔landscape pixel helpers
src/sim/transport.ts           Transport interface + createMockTransport
src/media/placeholder.ts       makePlaceholderSnap(seed) → ImageData (canvas)
src/state/store.tsx            AppProvider, useApp()
src/components/Avatar.tsx      procedural SVG faces, group avatar, badge, ring
src/components/Icon.tsx        all inline SVG icons by name
src/components/Logo.tsx        original outline logo mark
src/components/StatusLine.tsx  status icon + word + time + streak
src/components/thread/*        MessageList, Message variants, PresenceChips, ChatInput
src/components/SnapCanvas.tsx  paints rows from transport into portrait canvas
src/components/SendToList.tsx
src/desktop/*                  DesktopApp, Sidebar, ChatRow, Conversation, RightPane, CameraCard, PreviewCard, ViewerCard
src/mobile/*                   MobileApp, BottomNav, ChatListScreen, MobileChatRow, CameraScreen, ConversationScreen, PreviewScreen, SendToScreen, ViewerScreen, PlaceholderScreen
src/demo/DemoPanel.tsx         Shift+D panel
```

Tests live next to code as `*.test.ts(x)`.

## Shared Interfaces (pinned — every task uses these names)

```ts
// src/types.ts
export const ME = 'me';
export interface Person { id: string; name: string; seed: number; color: string; badge?: string }
export type Medium = 'snap' | 'chat';
export type StatusKind = 'new-snap' | 'new-chat' | 'delivered' | 'opened' | 'received'
  | 'screenshot' | 'transmitting' | 'receiving' | 'queued' | 'failed' | 'tap-to-chat';
export interface ChatStatus { kind: StatusKind; medium: Medium; time?: string; streak?: number; progress?: number }
export type Message =
  | { id: string; senderId: string; type: 'text'; text: string; state?: 'sending' | 'receiving' }
  | { id: string; senderId: string; type: 'emoji' | 'sticker'; text: string }
  | { id: string; senderId: string; type: 'quote'; quoted: { senderId: string; text: string; time: string }; text: string }
  | { id: string; senderId: string; type: 'snap'; opened: boolean };
export interface Chat { id: string; title: string; isGroup: boolean; memberIds: string[]; status: ChatStatus; messages: Message[]; hasIncomingSnap?: boolean; watch?: boolean }

// src/sim/transport.ts
export type Handle = string;
export const MODE = 'Robot36';
export interface TransportEvents {
  'tx:queued': (h: Handle, chatIds: string[]) => void;
  'tx:start': (h: Handle) => void;
  'tx:progress': (h: Handle, p: number) => void;      // 0..1
  'tx:done': (h: Handle) => void;
  'tx:cancelled': (h: Handle) => void;
  'rx:start': (h: Handle, from: string, kind: 'snap' | 'text', mode: string) => void;
  'rx:row': (h: Handle, index: number, row: Uint8ClampedArray) => void; // 0..239, 320 px RGBA
  'rx:text-chunk': (h: Handle, textSoFar: string) => void;
  'rx:progress': (h: Handle, p: number) => void;
  'rx:done': (h: Handle) => void;
  'rx:cancelled': (h: Handle) => void;
}
export interface Transport {
  sendText(chatId: string, text: string): Handle;
  sendSnap(chatIds: string[], image: ImageData): Handle;
  simulateIncoming(from: string, kind: 'snap' | 'text', payload: ImageData | string, startAt?: number): Handle; // mock-only hook; startAt 0..1 emits earlier rows immediately (Beatriz resumes at 0.62)
  cancel(h: Handle): void;
  on<K extends keyof TransportEvents>(event: K, fn: TransportEvents[K]): () => void;
}
export function createMockTransport(opts?: { snapMs?: number; textMs?: number }): Transport; // defaults 9000 / 1500

// src/state/store.tsx
export type PaneMode = null | { mode: 'camera'; to?: string } | { mode: 'preview'; to?: string } | { mode: 'sendto'; to?: string } | { mode: 'viewer'; chatId: string; handle: Handle };
export type MobileTab = 'map' | 'chat' | 'camera' | 'stories' | 'spotlight';
export type MobileOverlay = null | { type: 'conversation'; chatId: string } | { type: 'preview'; to?: string } | { type: 'sendto'; to?: string } | { type: 'viewer'; chatId: string; handle: Handle };
export interface AppApi {
  people: Record<string, Person>; chats: Chat[]; selectedChatId: string | null;
  pane: PaneMode; tab: MobileTab; overlay: MobileOverlay; capture: ImageData | null;
  transport: Transport; rxLabel: Record<Handle, string>;   // e.g. "Robot36 · 62% · 0:05"
  selectChat(id: string): void; setTab(t: MobileTab): void; setOverlay(o: MobileOverlay): void;
  openCamera(to?: string): void; closePane(): void; takeSnap(): void;      // takeSnap sets capture = makePlaceholderSnap()
  openSnap(chatId: string): void;   // starts/resumes simulated receive, opens viewer (pane on desktop, overlay on mobile)
  sendText(chatId: string, text: string): void; sendSnap(chatIds: string[]): void;
  cancel(h: Handle): void;
  demoIncoming(from: string, kind: 'snap' | 'text'): void; resetDemo(): void;
}
export function AppProvider(props: { children: React.ReactNode; transport?: Transport }): JSX.Element;
export function useApp(): AppApi;
```

---

### Task 1: Scaffold, tokens, types, mock data

**Files:** Create `package.json`, `vite.config.ts` (vitest jsdom env, setup file), `tsconfig.json`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/hooks/useIsMobile.ts`, `src/styles/tokens.css`, `src/types.ts`, `src/data/mock.ts`, `src/test/setup.ts`. Test: `src/data/mock.test.ts`, `src/hooks/useIsMobile.test.tsx`.

**Interfaces:** Produces `src/types.ts` exactly as pinned; `mock.ts` exports `people: Person[]`, `chats: Chat[]`; `useIsMobile(): boolean`.

- [ ] **Step 1:** `git checkout -b feat/ui`; scaffold Vite react-ts by hand (no interactive CLI); add deps `react react-dom @fontsource/nunito-sans`, dev `vite @vitejs/plugin-react typescript vitest jsdom @testing-library/react @testing-library/jest-dom @types/react @types/react-dom`. Scripts: `dev`, `build` (`tsc -b && vite build`), `test` (`vitest run`).
- [ ] **Step 2: failing tests**
  - `mock.test.ts`: every `chat.memberIds` id exists in `people` or is `ME`; chat ids unique; first five chat titles in order are `Beatriz M`, `💎Julie💎`, `Roomies`, `Starfish Squad ✨`, `Moe S`; total chats ≥ 12; `Roomies` is a group with members Sophie, Ben, Jen, ME and ≥ 7 messages including one `quote` (quoted time `4:37PM`), one `emoji`, one `sticker`; `Beatriz M` has `status.kind === 'receiving'`, `progress === 0.62`, `hasIncomingSnap`; one person name ≥ 28 chars.
  - `useIsMobile.test.tsx`: with `matchMedia('(max-width: 767px)')` mocked true → `true`; false → `false`; updates on `change` event.
- [ ] **Step 3:** Run `npm test` → FAIL.
- [ ] **Step 4:** Implement. Mock statuses per spec table "Mock data"; Roomies thread copies the reference conversation's message sequence. `tokens.css`: `:root` light set and `@media (prefers-color-scheme: dark)` dark set; names at least `--bg --bg-elev --bg-hover --border --text --text-2 --blue #0FADFF --purple #A05DCD --red #F23C57 --green #00C67F --yellow #FFFC00 --radius-card 10px`. Also `--font`. `App.tsx` renders placeholder `<div data-testid="desktop|mobile">`.
- [ ] **Step 5:** `npm test` PASS, `npm run build` exits 0.
- [ ] **Step 6:** Commit `chore(app): scaffold vite react app with tokens and mock data`.

### Task 2: Rotation helpers and mock transport

**Files:** Create `src/sim/rotate.ts`, `src/sim/transport.ts`. Test: `src/sim/rotate.test.ts`, `src/sim/transport.test.ts`.

**Interfaces:** Consumes nothing. Produces pinned `Transport`, `createMockTransport`, `MODE`; `rotateCW(p: ImageData): ImageData` (240×320 → 320×240; landscape pixel (x, y) = portrait pixel (px = y, py = 319 − x), so landscape row i = portrait column i); `paintRow(target: ImageData /*240×320*/, index: number, row: Uint8ClampedArray): void` (inverse). Tests construct `ImageData` via a tiny polyfill in `src/test/setup.ts` if jsdom lacks it (`{width,height,data}`).

- [ ] **Step 1: failing tests**
  - rotate: pixel at portrait (x=5,y=10) appears at landscape (x=309,y=5); `paintRow` of every row of `rotateCW(p)` into a blank 240×320 reproduces `p` byte-for-byte.
  - transport (vi.useFakeTimers, snapMs 9000, textMs 1500): `sendText` emits `tx:start`, progress increasing, `tx:done` at 1500 ms; `simulateIncoming('beatriz','snap',img)` emits `rx:start` with mode `Robot36`, exactly 240 `rx:row` with indices 0..239 in order, `rx:done` at 9000 ms; with `startAt: 0.62` rows 0..148 are emitted synchronously and `rx:done` fires at ~3420 ms; **busy channel**: `sendSnap` during a receive emits `tx:queued` immediately and `tx:start` only after `rx:done`; two `sendText` back-to-back run sequentially; **cancel** mid-receive at 4500 ms → `rx:cancelled`, no `rx:row` afterwards, next queued item starts; `simulateIncoming(...,'text','hello there')` emits `rx:text-chunk` with growing prefixes ending in the full string then `rx:done`; unsubscribe function returned by `on` stops delivery.
- [ ] **Step 2:** `npx vitest run src/sim` → FAIL.
- [ ] **Step 3:** Implement: FIFO queue, one active job, `setInterval` tick ~50 ms; snap rows emitted proportional to elapsed time; handles `tx-1`, `rx-2`…
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(sim): add mock half-duplex sstv and two-tone transport`.

### Task 3: Shared visual components (Avatar, Icon, Logo, StatusLine, placeholder snap)

**Files:** Create `src/components/Avatar.tsx`, `Avatar.css`, `Icon.tsx`, `Logo.tsx`, `StatusLine.tsx`, `StatusLine.css`, `src/media/placeholder.ts`. Test: `src/components/StatusLine.test.tsx`, `src/components/Avatar.test.tsx`.

**Interfaces:** Consumes types (Task 1). Produces:
- `Avatar({ people: Person[]; size: number; ring?: 'none'|'blue'|'green'; badge?: string })` — 1 person = face, 2–3 = overlapped group; background `var(--avatar-bg)`. Faces drawn from `seed` (skin, hair style ×6, hair colour, eyes, mouth, shirt). Original simple flat style.
- `Icon({ name: IconName; size?: number; filled?: boolean; color?: string })`, `IconName` = `'search'|'compose'|'gear'|'chevron-left'|'chevron-down'|'camera'|'bell'|'add-friend'|'more'|'map'|'chat'|'stories'|'spotlight'|'flip'|'flash-off'|'music'|'record'|'memories'|'gamepad'|'lens-sparkle'|'arrow'|'square'|'bubble'|'screenshot'|'wave'|'history'|'mic'|'sticker'|'laptop'|'send'|'close'|'check'`.
- `Logo({ size?: number })` — original outline mark (rounded blob + antenna + sine-wave mouth).
- `StatusLine({ status: ChatStatus })` — renders icon + word + ` · time` + ` · N🔥`.
- `makePlaceholderSnap(seed?: number): ImageData` — 240×320 original illustrated scene via canvas (sky gradient, sun, hills, seed varies palette).

- [ ] **Step 1: failing tests:** StatusLine renders text `New Snap · 16m · 29🔥` for `{kind:'new-snap',medium:'snap',time:'16m',streak:29}`; `Transmitting · 34%` for `{kind:'transmitting',medium:'snap',progress:0.34}`; `Receiving · 62%`; `Queued`; word element has `color: var(--purple)` for new-snap, `var(--blue)` for new-chat, `var(--green)` for receiving. Avatar renders one `<svg>` per person (max 3) and the badge text.
- [ ] **Step 2:** FAIL → **Step 3:** implement (icon strokes ~2px at 24px, rounded caps, matched to references) → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(ui): add avatars, icons, logo and status line`.

### Task 4: App store

**Files:** Create `src/state/store.tsx`. Modify `src/App.tsx` (wrap in `AppProvider`). Test: `src/state/store.test.tsx`.

**Interfaces:** Consumes Tasks 1–3. Produces pinned `AppProvider`, `useApp`, `PaneMode`, `MobileTab`, `MobileOverlay`, `AppApi`.

- [ ] **Step 1: failing tests** (render hook inside `AppProvider` with `createMockTransport({snapMs:900,textMs:150})`, fake timers; stub `makePlaceholderSnap` via `vi.mock`):
  - initial `selectedChatId` = Roomies id, `pane` null, `tab` `'chat'`.
  - `openCamera()` → pane `{mode:'camera'}`; `takeSnap()` → pane `preview`, `capture` set; `closePane()` → null.
  - `sendSnap([julie, moe])` → both statuses `transmitting` with identical progress during send, then both `delivered` time `now`; pane null.
  - `sendText(roomies,'hi')` → last message `{type:'text',text:'hi',senderId:ME,state:'sending'}`, state cleared after done.
  - send while receiving → status `queued`.
  - `openSnap(beatriz)` → pane viewer with handle; after done `rxLabel[h]` = `Robot36 · received`; `closePane` → Beatriz status `opened`, medium snap.
  - `cancel(h)` during viewer → `rxLabel[h]` = `Robot36 · stopped`.
  - `demoIncoming(jen,'text')` → incoming message `state:'receiving'` text grows, row status `receiving` medium chat, ends `new-chat`.
- [ ] **Step 2:** FAIL → **Step 3:** implement with `useReducer` + transport subscriptions; `rxLabel` format `Robot36 · 62% · 0:05` (elapsed m:ss). `openSnap` picks pane (desktop) or overlay (mobile) by `matchMedia`.
- [ ] **Step 4:** PASS. **Step 5:** Commit `feat(state): add app store wired to mock transport`.

### Task 5: Desktop sidebar

**Files:** Create `src/desktop/DesktopApp.tsx`, `DesktopApp.css`, `Sidebar.tsx`, `Sidebar.css`, `ChatRow.tsx`. Modify `src/App.tsx` (render `DesktopApp`). Test: `src/desktop/Sidebar.test.tsx`.

**Interfaces:** Consumes `useApp`, `Avatar`, `Icon`, `Logo`, `StatusLine`. Produces `DesktopApp` grid: `grid-template-columns: 309px minmax(320px,1fr) [pane 456px when open]`, with slots for `Conversation` (Task 6) and `RightPane` (Task 7) imported from `./Conversation` and `./RightPane` (create stub exports if absent).

- [ ] **Step 1: failing test:** rows render in mock order; typing `ju` in Search shows only `💎Julie💎`; clicking Roomies calls `selectChat`; selected row has class `is-selected`; new-snap row shows right indicator.
- [ ] **Step 2:** FAIL → **Step 3:** implement to spec "Sidebar" values → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): add sidebar with chat list and search`.

### Task 6: Thread components + desktop conversation

**Files:** Create `src/components/thread/MessageList.tsx`, `Message.tsx`, `PresenceChips.tsx`, `ChatInput.tsx`, `thread.css`, `src/desktop/Conversation.tsx`, `Conversation.css`. Test: `src/components/thread/MessageList.test.tsx`.

**Interfaces:** Consumes `useApp`, types, `Avatar`, `Icon`. Produces `MessageList({ chat: Chat })`, `ChatInput({ onSend(text: string): void; onCamera(): void })`, `PresenceChips({ people: Person[] })` — reused by mobile (Task 9), themed purely through tokens.

- [ ] **Step 1: failing test:** consecutive messages from one sender render one uppercase label; ME label text `ME`; quote card shows `4:37PM`; message with `state:'sending'` shows `Sending…`; `state:'receiving'` shows `Receiving · two-tone`; snap message renders button `Snap` that calls `openSnap`; ChatInput Enter calls `onSend` with trimmed text and clears; empty text not sent.
- [ ] **Step 2:** FAIL → **Step 3:** implement per spec "Conversation card" (no Call buttons) → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): add conversation thread and chat input`.

### Task 7: Snap canvas, Send To, desktop right pane

**Files:** Create `src/components/SnapCanvas.tsx`, `src/components/SendToList.tsx`, `SendToList.css`, `src/desktop/RightPane.tsx`, `RightPane.css`. Test: `src/components/SnapCanvas.test.tsx`, `src/components/SendToList.test.tsx`.

**Interfaces:** Consumes `useApp`, `paintRow`, `Icon`, `Avatar`. Produces `SnapCanvas({ handle: Handle })` (subscribes to `rx:row` for that handle, paints via `paintRow` into a 240×320 canvas, CSS-scaled, draws a vertical scan line at the paint front) and `SendToList({ initial?: string; onSend(ids: string[]): void })` — both reused by mobile.

- [ ] **Step 1: failing tests:** SnapCanvas calls `paintRow` once per `rx:row` for its handle and ignores other handles (spy on module); SendToList preselects `initial`, toggling rows changes selection, Send disabled with none selected, calls `onSend` with ids.
- [ ] **Step 2:** FAIL → **Step 3:** implement RightPane modes camera / preview / sendto / viewer per spec "Right pane" (3:4 card ≈ 456×608, header pill `Close` grey / `Stop` red while running, Esc closes) → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(desktop): add camera, send-to and snap viewer pane`.

### Task 8: Mobile shell, bottom nav, chat list

**Files:** Create `src/mobile/MobileApp.tsx`, `MobileApp.css`, `BottomNav.tsx`, `ChatListScreen.tsx`, `ChatListScreen.css`, `MobileChatRow.tsx`, `PlaceholderScreen.tsx`. Modify `src/App.tsx`. Test: `src/mobile/ChatListScreen.test.tsx`.

**Interfaces:** Consumes `useApp`, shared components. Produces `MobileApp` switching on `tab` and rendering `overlay` screens imported from `./ConversationScreen`, `./CameraScreen`, `./PreviewScreen`, `./SendToScreen`, `./ViewerScreen` (stub exports if absent; Task 9 fills them). Safe-area padding via `env(safe-area-inset-*)`.

- [ ] **Step 1: failing test:** title `Chat`; chips `My AI`, `Flashbacks`, `Groups`, `Near me`, `Best Friends`; add-friend badge `5`; tapping a row sets overlay conversation; tapping a row with `hasIncomingSnap` calls `openSnap`; row camera icon calls `openCamera(id)` and sets tab `camera`; bottom nav has 5 buttons and the active one has `aria-current="page"`.
- [ ] **Step 2:** FAIL → **Step 3:** implement per spec "Chat list (mobile)" / "Bottom nav" → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(mobile): add chat list and bottom navigation`.

### Task 9: Mobile camera, conversation, preview, send-to, viewer

**Files:** Create `src/mobile/CameraScreen.tsx`, `CameraScreen.css`, `ConversationScreen.tsx`, `PreviewScreen.tsx`, `SendToScreen.tsx`, `ViewerScreen.tsx`, `screens.css`. Test: `src/mobile/CameraScreen.test.tsx`.

**Interfaces:** Consumes Tasks 4, 6, 7, 8 exports.

- [ ] **Step 1: failing test:** camera shows zoom `.5 1x 2.5` with `1x` selected, tabs `Favourites`, `Create with AI` (selected), `Aesthetic`; shutter → overlay preview; preview Send To → sendto; sending → overlay null, tab `chat`.
- [ ] **Step 2:** FAIL → **Step 3:** implement per spec "Camera (mobile)", "Mobile conversation", "Snap viewer (mobile)" (lens circles = original gradients) → **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(mobile): add camera, conversation and snap screens`.

### Task 10: Demo panel + visual verification

**Files:** Create `src/demo/DemoPanel.tsx`, `DemoPanel.css`. Modify `src/App.tsx`. Test: `src/demo/DemoPanel.test.tsx`.

- [ ] **Step 1: failing test:** hidden by default; Shift+D toggles; buttons call `demoIncoming(id,'snap')`, `demoIncoming(id,'text')`, `resetDemo()`.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS; `npm run build` exits 0.
- [ ] **Step 5:** Run `npm run dev`; with playwright-cli screenshot desktop 1268×706 and mobile 428×926 in **light and dark** (`colorScheme`), plus camera tab, open pane at 900×706, mobile at 375 wide. Compare against `docs/reference/*.png`; fix spacing/size/colour gaps; confirm no horizontal scroll and long-name ellipsis.
- [ ] **Step 6:** Commit `feat(demo): add demo controls panel` (and `fix(ui): …` commits for tuning).

## Execution waves (parallelism)

1. Task 1 → 2. Tasks 2 and 3 in parallel → 3. Task 4 → 4. Tasks 5, 6, 7, 8 in parallel (disjoint files; App.tsx edits by 5 and 8 are one-line and reconciled by the controller) → 5. Task 9 → 6. Task 10.
