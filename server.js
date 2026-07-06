/**
 * WebAMT — a modern web-based Intel(R) AMT management console.
 *
 * The server is a thin, stateless WebSocket <-> TCP/TLS relay. Browsers cannot
 * open raw TCP sockets to Intel AMT (ports 16992/16993), so this process bridges
 * a WebSocket to the AMT device. All authentication (HTTP Digest for WSMAN and
 * the redirection-protocol Digest for SOL/KVM) is computed in the browser, so no
 * AMT credentials are ever sent to or stored by this relay.
 *
 * @license Apache-2.0
 */

'use strict';

const net = require('net');
const tls = require('tls');
const path = require('path');
const express = require('express');

const pkg = require('./package.json');

function parseArgs(argv) {
    const args = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const key = a.substring(2);
            const next = argv[i + 1];
            if (next != null && !next.startsWith('--')) { args[key] = next; i++; } else { args[key] = true; }
        }
    }
    return args;
}

const args = parseArgs(process.argv);
const PORT = (() => { const p = parseInt(args.port, 10); return (!isNaN(p) && p > 0 && p < 65536) ? p : 3000; })();
const BIND = (args.any != null) ? '0.0.0.0' : '127.0.0.1';
const DEBUG = args.debug != null;

const app = express();
require('express-ws')(app); // express-ws v2: patches app so app.listen() serves WebSockets

app.disable('x-powered-by');
app.use((req, res, next) => { res.set({ 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache', 'Expires': '0' }); next(); });
app.use(express.static(path.join(__dirname, 'public')));

function debug(...m) { if (DEBUG) console.log('[relay]', ...m); }

// Health / info endpoint
app.get('/api/info', (req, res) => {
    res.json({ name: 'WebAMT', version: pkg.version, node: process.version, platform: process.platform });
});

/**
 * Reject cross-origin WebSocket connections. Browsers send an Origin header on
 * WebSocket upgrades; without this check any web page you visit could use the
 * relay as a proxy into your network (cross-site WebSocket hijacking).
 * Non-browser clients that send no Origin header are allowed.
 */
function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
}

/**
 * The relay endpoint. Query params:
 *   host    - AMT device hostname / IP
 *   port    - AMT port (16992 = HTTP, 16993 = TLS)
 *   tls     - '1' to wrap the TCP connection in TLS
 *   tls1only- '1' to force TLSv1 (used as a fallback by the client)
 * Credentials are NOT passed here; the browser performs Digest auth end-to-end.
 */
app.ws('/relay', (ws, req) => {
    const host = req.query.host;
    const port = parseInt(req.query.port, 10);
    const useTls = req.query.tls == 1;
    const tls1only = req.query.tls1only == 1;

    if (!sameOrigin(req)) {
        debug('rejecting cross-origin relay request from', req.headers.origin);
        try { ws.close(1008, 'cross-origin'); } catch (e) {}
        return;
    }
    if (!host || isNaN(port) || port < 1 || port > 65535) {
        debug('rejecting bad relay request', req.query);
        try { ws.close(1008, 'bad request'); } catch (e) {}
        return;
    }

    let forward = null;
    let closed = false;

    const closeAll = () => {
        if (closed) return; closed = true;
        if (forward) { try { forward.destroy(); } catch (e) {} }
        try { ws.close(); } catch (e) {}
    };

    const onTcpData = (data) => {
        // data arrives as a Buffer; forward as binary over the websocket
        try { ws.send(data); } catch (e) {}
    };

    const wireTcp = () => {
        forward.setNoDelay(true);
        forward.on('data', onTcpData);
        forward.on('close', () => { debug('tcp close', host, port); closeAll(); });
        forward.on('error', (err) => { debug('tcp error', host, port, err.code); closeAll(); });
    };

    debug('open', host, port, 'tls=' + (useTls ? 1 : 0));

    if (useTls) {
        const tlsopts = {
            // Old AMT firmware only speaks TLSv1.0; allow it here (the client falls
            // back to tls1only=1 when the initial handshake fails).
            minVersion: 'TLSv1',
            maxVersion: tls1only ? 'TLSv1' : undefined,
            // @SECLEVEL=0 lets OpenSSL 3 (Node 18+) complete TLSv1.0/1.1 handshakes
            // with old AMT firmware; cert trust is not relied on anyway (see below).
            ciphers: 'RSA+AES:!aNULL:!MD5:!DSS:@SECLEVEL=0',
            rejectUnauthorized: false // AMT devices typically present self-signed certs
        };
        forward = tls.connect(port, host, tlsopts, () => { debug('tls connected', host, port); });
        wireTcp();
    } else {
        forward = new net.Socket();
        wireTcp();
        forward.connect(port, host, () => { debug('tcp connected', host, port); });
    }

    // Browser -> AMT
    ws.on('message', (msg) => {
        if (!forward || closed) return;
        // ws frames may be Buffer (binary) or string; normalise to Buffer
        const buf = Buffer.isBuffer(msg) ? msg : Buffer.from(msg, 'binary');
        try { forward.write(buf); } catch (e) {}
    });

    ws.on('close', () => { debug('ws close', host, port); closeAll(); });
    ws.on('error', () => closeAll());
});

app.listen(PORT, BIND, () => {
    const shown = (BIND === '0.0.0.0') ? '*' : BIND;
    console.log('');
    console.log('  WebAMT — Intel(R) AMT web console');
    console.log('  Running at http://' + shown + ':' + PORT + '/');
    if (BIND === '127.0.0.1') { console.log('  (localhost only; pass --any to expose on all interfaces)'); }
    console.log('');
});
