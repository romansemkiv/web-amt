/**
 * WebAMT — Management Presence Server (MPS) / CIRA listener.
 *
 * Intel AMT "Client Initiated Remote Access" (CIRA) inverts the usual connection
 * direction: instead of the console dialing the device on 16992-16995, the AMT
 * firmware dials *out* over TLS to this listener (default port 4433) and keeps a
 * persistent tunnel open. Management traffic is then multiplexed back through that
 * tunnel using APF — an SSH-derived channel protocol (RFC 4254 message shapes).
 *
 * This module terminates the TLS connection, speaks APF, authenticates the device
 * against a configured username/password, and exposes each connected device so the
 * relay in server.js can open a forwarded-tcpip channel to it. The browser keeps
 * doing HTTP-Digest / redirection auth end-to-end *inside* the tunnel, so this
 * server never sees AMT admin credentials — same trust model as the direct relay.
 *
 * The APF wire format is big-endian. Strings are a uint32 length followed by bytes.
 * Reference: Intel AMT SDK "APF" documentation and the MeshCentral MPS server.
 *
 * @license Apache-2.0
 */

'use strict';

const fs = require('fs');
const path = require('path');
const tls = require('tls');

// ---- APF message types ----
const APF = {
    DISCONNECT: 1,
    SERVICE_REQUEST: 5,
    SERVICE_ACCEPT: 6,
    USERAUTH_REQUEST: 50,
    USERAUTH_FAILURE: 51,
    USERAUTH_SUCCESS: 52,
    GLOBAL_REQUEST: 80,
    REQUEST_SUCCESS: 81,
    REQUEST_FAILURE: 82,
    CHANNEL_OPEN: 90,
    CHANNEL_OPEN_CONFIRMATION: 91,
    CHANNEL_OPEN_FAILURE: 92,
    CHANNEL_WINDOW_ADJUST: 93,
    CHANNEL_DATA: 94,
    CHANNEL_CLOSE: 97,
    PROTOCOLVERSION: 192,
    KEEPALIVE_REQUEST: 208,
    KEEPALIVE_REPLY: 209,
    KEEPALIVE_OPTIONS_REQUEST: 210,
    KEEPALIVE_OPTIONS_REPLY: 211
};

// Flow-control window we advertise to the device for each channel (device -> us).
// We top the window back up once the device has consumed half of it.
const CHANNEL_RX_WINDOW = 32768;
const CHANNEL_MAX_PACKET = 0xFFFFFF; // largest single CHANNEL_DATA payload we accept

function u32(n) { const b = Buffer.allocUnsafe(4); b.writeUInt32BE(n >>> 0, 0); return b; }

// APF string field: uint32 length + bytes.
function apfStr(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([u32(b.length), b]); }

// AMT reports its UUID as a mixed-endian (Microsoft-style) GUID: the first three
// groups are little-endian, the last two big-endian. Render it canonically.
function guidToStr(buf16) {
    const g = buf16.toString('hex');
    const at = (o, n) => g.substr(o, n);
    return (at(6, 2) + at(4, 2) + at(2, 2) + at(0, 2) + '-' +
        at(10, 2) + at(8, 2) + '-' + at(14, 2) + at(12, 2) + '-' +
        at(16, 4) + '-' + at(20, 12)).toUpperCase();
}

/**
 * Obtain the TLS key/cert for the listener. Priority:
 *   1. explicit --mps-cert / --mps-key files
 *   2. previously generated pair next to this module (mps-cert.pem / mps-key.pem)
 *   3. generate a fresh self-signed pair (needs the optional 'selfsigned' package)
 * The generated pair is persisted so the device sees a stable certificate across
 * restarts (AMT can be provisioned to trust it by hash).
 */
function loadTlsCredentials(opts) {
    if (opts.cert && opts.key) {
        return { cert: fs.readFileSync(opts.cert), key: fs.readFileSync(opts.key) };
    }
    const certPath = path.join(__dirname, 'mps-cert.pem');
    const keyPath = path.join(__dirname, 'mps-key.pem');
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    }
    let selfsigned;
    try { selfsigned = require('selfsigned'); }
    catch (e) {
        throw new Error('No MPS certificate available. Pass --mps-cert/--mps-key, or run "npm install" so a self-signed one can be generated.');
    }
    const pems = selfsigned.generate(
        [{ name: 'commonName', value: 'WebAMT-MPS' }],
        { keySize: 2048, days: 3650, algorithm: 'sha256' }
    );
    try { fs.writeFileSync(keyPath, pems.private); fs.writeFileSync(certPath, pems.cert); } catch (e) {}
    return { cert: pems.cert, key: pems.private };
}

/**
 * Start the MPS listener.
 * opts: { port, host, user, pass, cert, key, debug }
 * Returns a handle: { server, list(), get(guid), close() }.
 * get(guid) yields the connection whose openChannel(port, handlers) tunnels a
 * WebSocket relay to the device over APF.
 */
function createMpsServer(opts) {
    const debug = opts.debug ? (...m) => console.log('[mps]', ...m) : () => {};
    const devices = new Map(); // guid -> connection

    const creds = loadTlsCredentials(opts);
    const tlsOpts = {
        key: creds.key,
        cert: creds.cert,
        // AMT firmware negotiates old TLS; accept it and relax OpenSSL 3 defaults.
        minVersion: 'TLSv1',
        ciphers: 'RSA+AES:!aNULL:!MD5:!DSS:@SECLEVEL=0',
        // Username/password CIRA does not require a client certificate. (Mutual-TLS
        // CIRA could add requestCert:true here and validate in the connection handler.)
        requestCert: false
    };

    const server = tls.createServer(tlsOpts, (socket) => handleConnection(socket));

    server.on('tlsClientError', (err) => debug('tls client error', err.code || err.message));
    server.on('error', (err) => console.error('[mps] server error', err.message));

    function handleConnection(socket) {
        const remote = socket.remoteAddress + ':' + socket.remotePort;
        debug('device connected from', remote);

        const conn = {
            socket: socket,
            remote: remote,
            guid: null,
            user: null,
            authed: false,
            since: Date.now(),
            forwards: [],            // ports the device asked us to forward
            acc: Buffer.alloc(0),    // inbound APF accumulator
            channels: new Map(),     // ourChannelId -> channel
            nextChannel: 0
        };

        socket.setNoDelay(true);
        socket.on('data', (chunk) => {
            conn.acc = conn.acc.length ? Buffer.concat([conn.acc, chunk]) : chunk;
            try { processAccumulator(conn); }
            catch (e) { debug('parse error', e.message); teardown(conn); }
        });
        socket.on('error', (err) => { debug('socket error', remote, err.code); teardown(conn); });
        socket.on('close', () => { debug('device disconnected', remote); teardown(conn); });
    }

    function send(conn, buf) {
        if (conn.socket && !conn.socket.destroyed) { try { conn.socket.write(buf); } catch (e) {} }
    }

    function teardown(conn) {
        if (conn.closed) return;
        conn.closed = true;
        conn.channels.forEach((ch) => { try { if (ch.onClose) ch.onClose(); } catch (e) {} });
        conn.channels.clear();
        try { conn.socket.destroy(); } catch (e) {}
        if (conn.guid && devices.get(conn.guid) === conn) devices.delete(conn.guid);
    }

    /**
     * Consume as many complete APF messages as are buffered. Each handler returns
     * the number of bytes the message occupied, or 0 when more data is needed.
     */
    function processAccumulator(conn) {
        while (conn.acc.length >= 1) {
            const consumed = handleMessage(conn, conn.acc);
            if (consumed <= 0) return;           // wait for more bytes
            conn.acc = conn.acc.subarray(consumed);
        }
    }

    function handleMessage(conn, data) {
        const type = data[0];
        switch (type) {
            case APF.PROTOCOLVERSION: {          // device announces itself
                if (data.length < 93) return 0;
                conn.guid = guidToStr(data.subarray(13, 29));
                debug('protocol version, guid', conn.guid);
                return 93;
            }
            case APF.SERVICE_REQUEST: {           // "auth@..." then "pfwd@..."
                if (data.length < 5) return 0;
                const len = data.readUInt32BE(1);
                if (data.length < 5 + len) return 0;
                const name = data.toString('utf8', 5, 5 + len);
                debug('service request', name);
                send(conn, Buffer.concat([Buffer.from([APF.SERVICE_ACCEPT]), apfStr(name)]));
                return 5 + len;
            }
            case APF.USERAUTH_REQUEST:
                return handleUserAuth(conn, data);
            case APF.GLOBAL_REQUEST:
                return handleGlobalRequest(conn, data);
            case APF.CHANNEL_OPEN_CONFIRMATION: {
                if (data.length < 17) return 0;
                const ourId = data.readUInt32BE(1);
                const theirId = data.readUInt32BE(5);
                const window = data.readUInt32BE(9);
                const ch = conn.channels.get(ourId);
                if (ch) {
                    ch.theirId = theirId;
                    ch.sendWindow = window;
                    ch.open = true;
                    debug('channel', ourId, 'confirmed (device', theirId + ', window', window + ')');
                    if (ch.onConnect) { try { ch.onConnect(); } catch (e) {} }
                    flushChannel(conn, ch);
                }
                return 17;
            }
            case APF.CHANNEL_OPEN_FAILURE: {
                if (data.length < 17) return 0;
                const ourId = data.readUInt32BE(1);
                const ch = conn.channels.get(ourId);
                debug('channel', ourId, 'open failed');
                if (ch) { conn.channels.delete(ourId); if (ch.onClose) try { ch.onClose(); } catch (e) {} }
                return 17;
            }
            case APF.CHANNEL_WINDOW_ADJUST: {
                if (data.length < 9) return 0;
                const ourId = data.readUInt32BE(1);
                const add = data.readUInt32BE(5);
                const ch = conn.channels.get(ourId);
                if (ch) { ch.sendWindow += add; flushChannel(conn, ch); }
                return 9;
            }
            case APF.CHANNEL_DATA: {
                if (data.length < 9) return 0;
                const ourId = data.readUInt32BE(1);
                const len = data.readUInt32BE(5);
                if (data.length < 9 + len) return 0;
                const payload = data.subarray(9, 9 + len);
                const ch = conn.channels.get(ourId);
                if (ch) {
                    if (ch.onData) { try { ch.onData(Buffer.from(payload)); } catch (e) {} }
                    // Replenish the device's send window as it consumes ours.
                    ch.rxConsumed += len;
                    if (ch.rxConsumed >= (CHANNEL_RX_WINDOW >> 1)) {
                        send(conn, Buffer.concat([Buffer.from([APF.CHANNEL_WINDOW_ADJUST]), u32(ch.theirId), u32(ch.rxConsumed)]));
                        ch.rxConsumed = 0;
                    }
                }
                return 9 + len;
            }
            case APF.CHANNEL_CLOSE: {
                if (data.length < 5) return 0;
                const ourId = data.readUInt32BE(1);
                const ch = conn.channels.get(ourId);
                if (ch) {
                    if (!ch.closedByUs) send(conn, Buffer.concat([Buffer.from([APF.CHANNEL_CLOSE]), u32(ch.theirId)]));
                    conn.channels.delete(ourId);
                    if (ch.onClose) try { ch.onClose(); } catch (e) {}
                }
                return 5;
            }
            case APF.CHANNEL_OPEN: {              // device-initiated channel — we don't accept these
                if (data.length < 5) return 0;
                const len = data.readUInt32BE(1);
                if (data.length < 33 + len) return 0; // type + senderChan + window + maxpkt + 3 strings...
                const senderChannel = data.readUInt32BE(5 + len);
                send(conn, Buffer.concat([Buffer.from([APF.CHANNEL_OPEN_FAILURE]), u32(senderChannel), u32(1), u32(0), u32(0)]));
                // Length of a CHANNEL_OPEN varies; resync by dropping the accumulator.
                conn.acc = Buffer.alloc(0);
                return 0;
            }
            case APF.KEEPALIVE_REQUEST: {
                if (data.length < 5) return 0;
                send(conn, Buffer.concat([Buffer.from([APF.KEEPALIVE_REPLY]), data.subarray(1, 5)]));
                return 5;
            }
            case APF.KEEPALIVE_OPTIONS_REQUEST: {
                if (data.length < 9) return 0;
                send(conn, Buffer.concat([Buffer.from([APF.KEEPALIVE_OPTIONS_REPLY]), u32(0), u32(0)]));
                return 9;
            }
            case APF.DISCONNECT:
                debug('device sent disconnect');
                teardown(conn);
                return data.length; // consume everything; connection is going away
            default:
                debug('unknown APF message', type, '- resyncing');
                conn.acc = Buffer.alloc(0);
                return 0;
        }
    }

    function handleUserAuth(conn, data) {
        // 50 | user(str) | service(str) | method(str) | [if password:] bool + password(str)
        let o = 1;
        if (data.length < o + 4) return 0;
        const ulen = data.readUInt32BE(o); o += 4;
        if (data.length < o + ulen + 4) return 0;
        const user = data.toString('utf8', o, o + ulen); o += ulen;
        const slen = data.readUInt32BE(o); o += 4;
        if (data.length < o + slen + 4) return 0;
        o += slen; // service name (e.g. pfwd@amt.intel.com)
        const mlen = data.readUInt32BE(o); o += 4;
        if (data.length < o + mlen) return 0;
        const method = data.toString('utf8', o, o + mlen); o += mlen;

        let pass = '';
        if (method === 'password') {
            if (data.length < o + 1 + 4) return 0;
            o += 1; // boolean "change password" flag
            const plen = data.readUInt32BE(o); o += 4;
            if (data.length < o + plen) return 0;
            pass = data.toString('utf8', o, o + plen); o += plen;
        }

        const ok = (user === opts.user) && (method === 'password') && (pass === opts.pass);
        if (ok) {
            conn.user = user;
            conn.authed = true;
            if (conn.guid) {
                const prev = devices.get(conn.guid);
                if (prev && prev !== conn) teardown(prev);
                devices.set(conn.guid, conn);
            }
            debug('auth success for', user, 'guid', conn.guid);
            send(conn, Buffer.from([APF.USERAUTH_SUCCESS]));
        } else {
            debug('auth FAILURE for', user, '(rejecting)');
            // 51 | list-of-methods(str "password") | partial-success(bool)
            send(conn, Buffer.concat([Buffer.from([APF.USERAUTH_FAILURE]), apfStr('password'), Buffer.from([0])]));
        }
        return o;
    }

    function handleGlobalRequest(conn, data) {
        // 80 | requestName(str) | wantReply(bool) | [request-specific]
        let o = 1;
        if (data.length < o + 4) return 0;
        const nlen = data.readUInt32BE(o); o += 4;
        if (data.length < o + nlen + 1) return 0;
        const name = data.toString('utf8', o, o + nlen); o += nlen;
        const wantReply = data[o]; o += 1;

        if (name === 'tcpip-forward') {
            // requestName | addr(str) | port(uint32)
            if (data.length < o + 4) return 0;
            const alen = data.readUInt32BE(o); o += 4;
            if (data.length < o + alen + 4) return 0;
            o += alen; // bind address
            const port = data.readUInt32BE(o); o += 4;
            if (conn.forwards.indexOf(port) < 0) conn.forwards.push(port);
            debug('tcpip-forward port', port);
            // REQUEST_SUCCESS carries the bound port back to the device.
            if (wantReply) send(conn, Buffer.concat([Buffer.from([APF.REQUEST_SUCCESS]), u32(port)]));
            return o;
        }

        // cancel-tcpip-forward and keepalive-style global requests: just acknowledge.
        if (wantReply) send(conn, Buffer.from([APF.REQUEST_SUCCESS]));
        return o;
    }

    // Push queued outbound bytes to the device, respecting the channel send window.
    function flushChannel(conn, ch) {
        if (!ch.open) return;
        while (ch.outQueue.length > 0 && ch.sendWindow > 0) {
            const n = Math.min(ch.outQueue.length, ch.sendWindow, CHANNEL_MAX_PACKET);
            const chunk = ch.outQueue.subarray(0, n);
            ch.outQueue = ch.outQueue.subarray(n);
            ch.sendWindow -= n;
            send(conn, Buffer.concat([Buffer.from([APF.CHANNEL_DATA]), u32(ch.theirId), u32(n), chunk]));
        }
    }

    /**
     * Open a forwarded-tcpip channel to a device port (e.g. 16992/16994) and return
     * a sink { write(buf), close() }. Writes before the channel is confirmed are
     * queued and flushed automatically. Handlers: onConnect, onData(buf), onClose.
     */
    function openChannel(conn, port, handlers) {
        const ourId = conn.nextChannel++;
        const ch = {
            ourId: ourId,
            theirId: 0,
            open: false,
            sendWindow: 0,
            rxConsumed: 0,
            outQueue: Buffer.alloc(0),
            onConnect: handlers.onConnect,
            onData: handlers.onData,
            onClose: handlers.onClose
        };
        conn.channels.set(ourId, ch);

        // CHANNEL_OPEN "forwarded-tcpip": type | ourChan | window | maxPacket
        //   | connectedAddr(str) | connectedPort | originAddr(str) | originPort
        // AMT routes by connectedPort matching a prior tcpip-forward registration.
        const msg = Buffer.concat([
            Buffer.from([APF.CHANNEL_OPEN]),
            apfStr('forwarded-tcpip'),
            u32(ourId), u32(CHANNEL_RX_WINDOW), u32(CHANNEL_MAX_PACKET),
            apfStr('127.0.0.1'), u32(port),
            apfStr('127.0.0.1'), u32(ourId + 2048)
        ]);
        send(conn, msg);
        debug('opening channel', ourId, 'to port', port);

        return {
            write: (buf) => { ch.outQueue = ch.outQueue.length ? Buffer.concat([ch.outQueue, buf]) : Buffer.from(buf); flushChannel(conn, ch); },
            close: () => {
                if (ch.closedByUs || conn.channels.get(ourId) !== ch) return;
                ch.closedByUs = true;
                if (ch.open) send(conn, Buffer.concat([Buffer.from([APF.CHANNEL_CLOSE]), u32(ch.theirId)]));
                conn.channels.delete(ourId);
            }
        };
    }

    server.listen(opts.port, opts.host, () => {
        const shown = (opts.host === '0.0.0.0') ? '*' : opts.host;
        console.log('  MPS/CIRA listener on ' + shown + ':' + opts.port + ' (TLS)');
    });

    return {
        server: server,
        // A device is routable once it has authenticated.
        get: (guid) => { const c = devices.get(String(guid).toUpperCase()); return (c && c.authed) ? c : null; },
        openChannel: (guid, port, handlers) => {
            const c = devices.get(String(guid).toUpperCase());
            if (!c || !c.authed) return null;
            return openChannel(c, port, handlers);
        },
        list: () => Array.from(devices.values())
            .filter((c) => c.authed)
            .map((c) => ({ guid: c.guid, user: c.user, addr: c.remote, since: c.since, forwards: c.forwards.slice() })),
        close: () => { try { server.close(); } catch (e) {} devices.forEach((c) => teardown(c)); }
    };
}

module.exports = { createMpsServer: createMpsServer };
