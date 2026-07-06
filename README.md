# WebAMT

A **modern, browser-based Intel® AMT / vPro management console** — a clean-design
alternative to [MeshCommander](https://github.com/Ylianst/MeshCommander), built on the
same proven Intel AMT protocol engine and inspired by
[MeshCentral](https://github.com/Ylianst/MeshCentral).

Manage your Intel AMT machines from any browser: power control, hardware inventory,
event & audit logs, network settings, a serial-over-LAN console, and a KVM remote
desktop — all in a responsive dark/light UI.

![status](https://img.shields.io/badge/Intel%20AMT-6%20to%2016%2B-4f8cff) ![license](https://img.shields.io/badge/license-Apache--2.0-2ecc8f)

---

## Why WebAMT

MeshCommander was retired and its UI is dated. WebAMT keeps the part that is hard and
battle-tested — the AMT WSMAN stack, the redirection transport, the SOL terminal and the
KVM decoder — and wraps it in a **fresh, modern, componentised interface** with a real
design system, a proper multi-device manager, live power state, and an inline WSMAN
explorer for power users.

## Features

| Area | What you get |
|------|--------------|
| **Device manager** | Add/edit/remove multiple AMT machines, per-device TLS, import/export, optional password caching |
| **Dashboard** | Live power-state orb, AMT version, provisioning state, system identity & UUID |
| **Power control** | Power up / down / cycle / reset, plus **boot-to** actions (BIOS Setup, PXE) using the full AMT boot-config workflow |
| **Hardware inventory** | Chassis, BIOS/firmware, processors, memory modules, storage devices |
| **Event log** | Full decoded AMT event log with severity, source and filtering; refresh & clear |
| **Audit log** | Decoded security audit records |
| **Network** | View **and edit** wired/wireless IPv4 (DHCP/static, IP/mask/gateway/DNS), general settings, Wi-Fi profiles |
| **User accounts** | Full management — **add / edit / delete / enable / disable** digest accounts with per-realm access control and the admin entry |
| **Settings** | **Enable/disable** SOL, IDER, KVM and the redirection listener; set user-consent (opt-in) policy |
| **Computer name** | Edit AMT host name, domain and FQDN sharing from the dashboard |
| **Serial console (SOL)** | Full VT100 serial-over-LAN terminal with selectable size |
| **Remote desktop (KVM)** | Hardware KVM viewer with keyboard/mouse, **auto-scales to the viewport**, RLE + optional ZLib, no session timeout |
| **Storage redirection (IDER)** | Mount a CD-ROM `.iso` or floppy `.img` from the browser and **boot the machine from it** |
| **WSMAN Explorer** | Enumerate or Get any AMT/CIM/IPS class and inspect the raw response |
| **UX** | Dark & light themes, responsive layout, no build step, fully self-contained (no CDN) |

## How it works

Browsers cannot open raw TCP sockets to Intel AMT (ports 16992–16995), so WebAMT ships a
tiny **stateless WebSocket ⇄ TCP/TLS relay** (`server.js`). The browser speaks the AMT
protocols end-to-end and the relay is a dumb pipe:

```
Browser (WSMAN / SOL / KVM + HTTP-Digest auth)
   │  WebSocket
   ▼
server.js  (WebSocket ⇄ TCP/TLS relay — a pure pipe)
   │  TCP 16992/16993 (WSMAN)  ·  16994/16995 (redirection)
   ▼
Intel AMT device
```

**All authentication (HTTP Digest for WSMAN and the redirection-protocol Digest for
SOL/KVM) is computed in the browser.** AMT credentials are never sent to, or stored by,
the relay.

## Quick start

Requires **Node.js 16 or newer**.

```bash
cd webamt
npm install
npm start           # serves http://127.0.0.1:3000  (localhost only)
```

Then open <http://127.0.0.1:3000>, click **＋**, and add a device:

- **Host/IP** — your AMT machine
- **Port** — `16992` (plain) or `16993` (TLS)
- **Username / Password** — your AMT admin credentials (default user is often `admin`)
- Tick **Use TLS** for 16993

### Options

| Flag | Description |
|------|-------------|
| `--port <n>` | Listen port (default `3000`) |
| `--any` | Bind to all interfaces instead of localhost only (`npm run start:any`) |
| `--debug` | Verbose relay logging (`npm run debug`) |

> **Security**
> - By default the relay binds to `127.0.0.1`; only use `--any` on a trusted network.
> - The relay rejects cross-origin WebSocket upgrades, so another web page you visit
>   can't use it as a proxy into your network.
> - AMT credentials are computed into Digest hashes **in the browser** and are never sent
>   to or stored by the relay. Passwords are kept in memory per browser session and are
>   only persisted to `localStorage` if you tick *Remember password*.
> - Prefer AMT TLS (port 16993). AMT devices usually present a self-signed certificate,
>   so the relay does not verify it — put the relay and the AMT device on a trusted
>   network segment.

## Project layout

```
webamt/
├── server.js                 modern WebSocket⇄TCP/TLS relay + static host
├── public/
│   ├── index.html            SPA shell (loads modules in dependency order)
│   ├── css/app.css           design system (dark/light, responsive)
│   └── js/
│       ├── engine/           vendored AMT protocol engine (MeshCommander, Apache-2.0)
│       │   ├── helpers.js        binary/string helpers
│       │   ├── md5.js            standalone MD5 for Digest auth (replaces node-forge)
│       │   ├── wsman-comm.js     WSMAN-over-WebSocket transport + HTTP Digest
│       │   ├── wsman-stack.js    WSMAN SOAP build/parse (get/put/enum/pull/invoke)
│       │   ├── amt-stack.js      high-level AMT ops + power/boot + event/audit decoders
│       │   ├── redirection.js    SOL/KVM/IDER redirection transport
│       │   ├── terminal.js       VT100 serial terminal
│       │   ├── kvm.js            AMT KVM (RFB) desktop decoder
│       │   └── zlib.js           inflate for KVM ZLib mode
│       ├── ui.js             toasts, modals, downloads/CSV, formatting  → UI
│       ├── amt-data.js       DMTF/AMT decoders (power, memory, chassis, dates) → AmtData
│       ├── core/
│       │   ├── dom.js            reusable HTML builders (cards, tables, kv, filters) → Comp
│       │   └── amt.js            AMT response accessors + Promise wrappers → Amt
│       ├── features/         one file per tab, each registers Views.<tab>
│       │   ├── registry.js       Views registry + shared helpers
│       │   ├── dashboard.js      power hero + system/management overview
│       │   ├── hardware.js       inventory + JSON export
│       │   ├── logs.js           event + audit logs (filter, JSON/CSV export)
│       │   ├── network.js        interfaces + IPv4 editing
│       │   ├── users.js          account CRUD (AMT_AuthorizationService)
│       │   ├── settings.js       feature toggles + consent policy
│       │   └── explorer.js       WSMAN class browser
│       ├── remote/           redirection viewers (share state via the Remote object)
│       │   ├── keys.js           KVM special-key sequences
│       │   ├── common.js         Remote state + lifecycle (stop/tab-change)
│       │   ├── terminal.js       Serial-over-LAN viewer
│       │   └── desktop.js        KVM viewer + toolbar
│       └── app.js            device store, connection, routing, power control → App
```

### Architecture notes

- **`Comp`** (core/dom.js) builds all markup — cards, data tables, key/value tables,
  stat tiles, filters, export menus — so views compose UI without repeating boilerplate.
- **`Amt`** (core/amt.js) wraps the callback-based stack in Promises (`get`/`enum`/`put`/
  `exec`/`batch`/`call`) and exposes response accessors (`pick`/`pickArr`/`version`), so
  multi-step flows (power boot sequence, account loading) read top-to-bottom with async/await.
- Each **feature** is an isolated file that registers `Views.<tab>`; adding a tab is one file
  plus one line in `App.TABS`.
- The **vendored engine** under `engine/` is never modified — only wrapped.

## Compatibility

Works with Intel AMT 6 through 16+ (same WSMAN surface MeshCommander supported). KVM
requires AMT with KVM redirection enabled — use the **Enable KVM** button in the Remote
Desktop tab, and note some machines require BIOS/opt-in configuration first.

## Credits & license

WebAMT is licensed under **Apache-2.0**.

The AMT protocol engine (WSMAN transport & stack, redirection transport, VT100 terminal,
KVM decoder, and event/audit-log decoders under `public/js/engine/`) is derived from
**[MeshCommander](https://github.com/Ylianst/MeshCommander)** by Ylian Saint-Hilaire /
Intel Corporation, also Apache-2.0. See `NOTICE`. The relay server, application shell,
UI, design system and views are original to WebAMT.

Intel and Intel AMT are trademarks of Intel Corporation. WebAMT is an independent project
and is not affiliated with or endorsed by Intel.
