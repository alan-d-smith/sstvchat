<div align="center">

<img src="public/favicon.svg" alt="SSTV Chat logo" width="96" height="96" />

# SSTV Chat

**Snap-style messaging where every message travels as sound.**

Texts are sent as two-tone digital audio. Photos are sent as real SSTV, the slow-scan television
mode amateur radio operators use for pictures. One device's speaker sends, another device's
microphone receives, and there's no network in between.

[**Live demo → sstvchat.uk**](https://sstvchat.uk) · [How it works](#how-it-works) · [Getting started](#getting-started) · [Protocol](#the-protocol)

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![Web Audio](https://img.shields.io/badge/Web%20Audio-AudioWorklet-FF6F00)
![Upstash Redis](https://img.shields.io/badge/Upstash-Redis-00E9A3?logo=upstash&logoColor=white)
![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)

</div>

---

## Why

Messaging apps hide the transport. SSTV Chat puts it front and centre. You can hear every
message leave one device and arrive at the next, and watch it decode line by line. The
interface is a familiar camera-first chat app, but under it is a small radio modem written in
TypeScript that runs entirely in the browser.

> **Fun fact:** the International Space Station sends pictures down to Earth with SSTV, the
> same technique this app uses. Its signal crosses hundreds of kilometres by radio; ours just
> crosses the room.

## Features

| | |
|---|---|
| 📸 **Snaps over SSTV** | Take a photo with the webcam or pick one from your gallery. Swipe the lens carousel to choose a filter (Normal, Mono or Warm). The snap is sent as a standard Robot36 SSTV transmission, so any SSTV decoder can read it. |
| 💬 **Texts over two-tone FSK** | Chat messages are framed, checksummed and sent as 3000 / 4000 Hz audio, above the band where voices are loud. Incoming texts show a typing indicator from the moment their header is heard. |
| 🎯 **Header-first addressing** | Every transmission opens with a short two-tone header saying who it's from and to. A listening device accepts only what's addressed to its username, and records it automatically. |
| 🎧 **Always-on receiver** | Once enabled, the microphone keeps listening. Snaps record in the background whichever chat you have open, and land only in the sender's chat. |
| 💾 **Saved locally** | Chats, messages and received images persist in `localStorage`. A snap that has been received is never received again. |
| 👤 **Accounts** | Sign up or log in with a unique username, an original avatar and an optional password, backed by Upstash Redis. |
| 👥 **Group chats** | Pick several people in New Chat to create a group on the server; group texts and snaps are addressed to every member over audio. |
| 🤝 **Friends** | Friend requests with a live badge, in-app and system notifications, and a directory of everyone on the app. |
| 🩺 **Radio diagnostics** | A live panel with mic settings, input level, tone strength, decoder counters and a decision log, plus one-click 10-second WAV capture for offline analysis. |
| 🌗 **Polished UI** | Desktop three-pane and mobile tab layouts that follow your system's light or dark theme. |

## How it works

```
  Sender                                                            Receiver
 ┌──────────────┐    two-tone header      SSTV image (Robot36)    ┌──────────────┐
 │ type / snap  │ ─▶ "from alan to bea" ─▶ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ ─▶ │ mic (always  │
 │  → modulate  │    3000/4000 Hz FSK      1500–2300 Hz, ~37 s    │  on) → decode│
 │  → speaker   │                                                 │  → chat      │
 └──────────────┘                                                 └──────────────┘
```

1. **Send:** the app builds a packet (sender, recipients, chat id, message id, text) and
   modulates it into audio with a continuous-phase FSK oscillator. Snaps send the same packet
   as a header twice (150 ms apart, same id), then 300 ms of silence, then the image as Robot36.
2. **Hear:** the receiver's AudioWorklet streams mic samples into an FSK demodulator (sliding
   Goertzel filters and a bit-clock loop) and a packet parser that resyncs on the magic bytes.
3. **Decide:** once the header fields are in, the device checks that it's a recipient. Its
   own transmissions, repeats, and packets addressed to other people are ignored.
4. **Decode:** text shows up as it arrives and is checked against a CRC-16. For snaps, the
   receiver switches to an FM demodulator, locks onto the VIS code, tracks each line's sync
   pulse to correct clock drift, and paints the picture column by column.

## Getting started

**Requirements:** Node.js ≥ 20.19 and a Chromium, Firefox or Safari browser with microphone
access.

```bash
git clone https://github.com/alan-d-smith/sstvchat.git
cd sstvchat
npm install
npm run dev          # http://localhost:5173
```

In development the API runs in memory inside the Vite dev server, so no database is needed.

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server with the in-memory API |
| `npm test` | Unit, component, modem and two-device end-to-end tests (Vitest) |
| `npm run build` | Type-check and build the production bundle to `dist/` |

### Try it with two devices

1. Open the app on two devices (for example a laptop and a phone) and pick a username on each.
2. Tap the page once on each device so the radio shows **Listening**.
3. Add each other as friends, open the chat and send a text or a snap.
4. Keep the devices **under about 1 m apart** with the sender's volume up.

> **Tips for a clean signal**
> - **Windows laptops:** turn off *Settings → System → Sound → your microphone → Audio
>   enhancements*, and any Dolby / Lenovo Vantage noise cancellation. Their noise suppression
>   removes steady tones.
> - **iPhone:** in Control Center, keep **Mic Mode** on *Standard*, never *Voice Isolation*.
> - Keep the page in the foreground; mobile browsers suspend the mic for background tabs.
> - The **Radio details** panel (Shift+R, or the link next to the radio pill) shows exactly
>   what the mic hears.

## The protocol

### Packet

```
'S' 'C' 0x01 │ LEN (u16, BE) │ PAYLOAD │ CRC-16/CCITT-FALSE (u16, BE)
PAYLOAD = kind · from · fromName · to(comma-separated) · chatId · mode · id · text   (UTF-8, 0x1F-separated)
```

`text` comes last so the receiver can show it while it's still arriving. `id` is a short
per-message identifier, so a device that hears the same transmission twice keeps one copy.

### Two-tone FSK (texts and headers)

| Parameter | Value |
|---|---|
| Mark / space | 3000 Hz / 4000 Hz (above the speech band, so room chatter barely reaches them) |
| Rate | 100 baud, UART 8-N-1, LSB first |
| Lead-in / tail | 300 ms / 60 ms of mark |
| Level | 0.95 of full scale (constant envelope), 5 ms fades |
| Airtime | ≈ 0.36 s + 0.1 s per byte (texts are capped at 140 characters) |

### SSTV (snaps)

| Parameter | Value |
|---|---|
| Mode | Robot36 (VIS code 8), 320 × 240, BT.601 YCbCr, 4:2:0 |
| Line | 9 ms sync · 3 ms porch · 88 ms Y · 4.5 ms separator · 1.5 ms porch · 44 ms chroma |
| Frequencies | Sync 1200 Hz, black 1500 Hz, white 2300 Hz |
| Duration | ≈ 37 s |

Snaps are portrait 240 × 320 images, rotated 90° into the landscape Robot36 frame and rotated
back on receipt. That's why they paint left to right.

## Architecture

```
src/
├── audio/        modems and the radio
│   ├── fsk.ts            two-tone modulator + streaming demodulator
│   ├── packet.ts         framing, CRC-16, incremental parser
│   ├── robot36.ts        SSTV modulator + streaming decoder (VIS, sync tracking)
│   ├── engine.ts         Web Audio: mic capture (AudioWorklet), playback, half duplex
│   ├── audioTransport.ts addressing, queueing, duplicate filtering
│   └── diagnostics.ts    live levels, tone power, decision log, WAV capture
├── state/        app store, accounts, friends, persistence (localStorage)
├── components/   shared UI: avatars, icons, thread, snap canvas, lens carousel…
├── desktop/      three-pane desktop layout
├── mobile/       tabbed mobile layout and full-screen screens
└── media/        camera capture, filters, gallery import
api/              Vercel Functions (Node runtime) backed by Upstash Redis
scripts/          WAV generator, offline decoder, browser end-to-end test
```

The UI only talks to the radio through a small `Transport` interface (`sendText`, `sendSnap`,
progress and receive events). A mock transport with the same interface drives the demo
controls (Shift+D) and the component tests.

## API

All endpoints are Vercel Functions on the Node.js runtime. Every write is authorised with the
device token created at sign-up.

| Endpoint | Purpose |
|---|---|
| `POST /api/claim` | `mode: "signup"` claims a free username (`^[a-z0-9_]{2,12}$`) with an optional password (salted scrypt) and an avatar. `mode: "login"` moves an existing name to this device with its password. Returns `200` ok, `400` invalid name, `401` wrong password, `404` no such user, `409` taken or no password set, `429` rate-limited (5 password guesses per name per 15 min). |
| `GET /api/users` | The directory: every claimed username and avatar. |
| `GET/POST /api/friends` | Friend requests: request, accept, decline, remove, and list incoming, outgoing and friends. |
| `GET/POST /api/groups` | Group chats created on the server (3–16 people): create, leave, rename, and list your groups. Members pick them up on the next sync; the messages themselves still travel over audio. |

## Deployment

The app deploys to **Vercel** as a static Vite site plus the functions in `api/`.

1. Import the repository in Vercel. The framework preset is **Vite**, the output directory is
   `dist`, and Node is 22.x.
2. Under **Storage**, connect an **Upstash Redis** database to the project for Production
   (and Preview).
3. Make sure the REST credentials are present as environment variables:
   `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, or `KV_REST_API_URL` /
   `KV_REST_API_TOKEN`. A custom prefix such as `STORAGE_…` works too.
4. Redeploy so the functions pick up the new variables.

If the variables are missing, the API answers `503 {"error":"not-configured"}` and the sign-up
screen says so.

## Testing

```bash
npm test                                   # everything below except the browser run
node scripts/make-wav.mjs out/             # write text.wav / snap.wav / both.wav (alice → bob)
node scripts/decode-wav.ts out/both.wav --self bob --levels
node scripts/browser-e2e.mjs out/          # Chromium with the WAV as a fake microphone
```

- **Modem tests:** loopback through silence, attenuation, 15 dB noise, 48 → 44.1 kHz
  resampling, clock drift and room echo.
- **Two-device end to end:** two real transports wired speaker-to-mic. A text and a snap from
  alice reach bob, never carol, and a repeated recording is received only once.
- **Browser end to end:** a real Chromium decodes a recorded transmission from its fake
  microphone.

## Credits

Built at a hackathon by Alan Smith. SSTV timing follows the published Robot36 specification
used by amateur radio software.

SSTV Chat is an independent project and isn't affiliated with or endorsed by Snap Inc. All
artwork (logo, avatars, illustrations) is original.

## License

[MIT](LICENSE) © 2026 Alan Smith
