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
| **CIRA / MPS listener** | Built-in **Management Presence Server**: AMT devices dial *in* over TLS (Client Initiated Remote Access) and are managed through the tunnel — WSMAN, SOL, KVM and IDER all work, no inbound path to the device required |
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

### CIRA / MPS (Client Initiated Remote Access)

When AMT machines can't be reached directly (behind NAT, on another network, or with no
inbound path), they can be provisioned to **dial into** WebAMT instead. WebAMT includes a
**Management Presence Server** (`mps.js`) — a TLS listener that speaks Intel's **APF**
protocol (an SSH-derived channel-multiplexing protocol) and keeps each device's tunnel
open:

```
Intel AMT device  ──dials out, TLS──►  server.js : MPS/CIRA listener (port 4433)
                                             │  APF forwarded-tcpip channels
Browser ──WebSocket──► server.js /relay ─────┘  (16992 WSMAN · 16994 redirection)
```

The device's traffic is multiplexed back through the tunnel, so **the same WSMAN, SOL,
KVM and IDER features work over CIRA** with no code changes — and HTTP-Digest auth is
still done end-to-end in the browser, so the MPS never sees AMT admin credentials.

Enable it with `--mps` (see options below), then in **Add device** tick *Connect via
CIRA* and pick the connected machine from the discovery list (its AMT GUID). Devices
authenticate to the MPS with the username/password you configure.

**Provisioning a device from WebAMT.** You don't need a separate tool to point a machine
at the MPS. Connect to the device directly (on your LAN), open **Settings → Remote Access
(CIRA)**, and WebAMT writes everything to the device for you: it adds the MPS server, adds
the server's own certificate as a trusted root (matched by CN), creates the remote-access
policy (periodic or user-initiated), and sets environment detection so the machine dials
in. The MPS username/password you enter must match the server's `--mps-user` / `--mps-pass`
(max 16 chars; AMT requires a strong password). Provisioning CIRA generally needs the
device in **Admin Control Mode (ACM)**.

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
| `--port <n>` | Web console listen port (default `3000`) |
| `--any` | Bind to all interfaces instead of localhost only (`npm run start:any`) |
| `--debug` | Verbose relay + MPS logging (`npm run debug`) |
| `--mps` | Enable the MPS/CIRA listener (requires `--mps-user` and `--mps-pass`) |
| `--mps-port <n>` | MPS/CIRA listen port (default `4433`) |
| `--mps-user <name>` | Username AMT devices must present for CIRA |
| `--mps-pass <secret>` | Password AMT devices must present for CIRA |
| `--mps-cert <file>` | TLS certificate for the MPS (PEM); auto-generated self-signed if omitted |
| `--mps-key <file>` | TLS private key for the MPS (PEM) |

Enable CIRA, for example:

```bash
node server.js --any --mps --mps-user admin --mps-pass 'your-secret'
# or: npm run mps   (uses a demo user/pass — change it)
```

If no `--mps-cert`/`--mps-key` is given, a self-signed pair is generated once and saved
as `mps-cert.pem` / `mps-key.pem` next to `server.js` (both git-ignored) so the device
sees a stable certificate across restarts.

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
> - The **MPS/CIRA listener** is off by default. When enabled it accepts inbound TLS from
>   AMT devices and requires a username/password (`--mps-user`/`--mps-pass`); connections
>   with the wrong credentials are rejected. Expose port `4433` only where your AMT
>   machines can reach it.

### Deploy on Coolify

A ready-made compose file, [`docker-compose.coolify.yml`](docker-compose.coolify.yml),
is included. In Coolify create a **Docker Compose** resource from this repo and point it
at that file, then set `MPS_USER` / `MPS_PASS` as environment variables and attach a
domain to the web console (port 3000). The MPS/CIRA port `4433` is a raw TLS listener, so
it's exposed via a direct host port mapping (not the proxy) — open it on your firewall so
AMT devices can dial in. See the comments in the file for details. Omit the `command:` and
the `4433` mapping to deploy the web console / direct relay only.

## Project layout

```
webamt/
├── server.js                 modern WebSocket⇄TCP/TLS relay + static host
├── mps.js                    MPS/CIRA listener — inbound TLS + APF tunnel routing
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
