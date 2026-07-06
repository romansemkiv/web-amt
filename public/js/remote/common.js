/**
 * Remote — shared state and lifecycle for the redirection features (SOL terminal & KVM).
 *
 * Both viewers reuse the vendored redirection transport. Shared state lives on this
 * object so terminal.js and desktop.js (separate files) can coordinate — only one
 * session is active at a time, and the app stops redirection when leaving the tab.
 */
var Remote = {
    STATE: ['Disconnected', 'Connecting…', 'Setup…', 'Connected'],

    // Active session handles, populated by terminal.js / desktop.js / ider.js.
    term: { obj: null, redir: null },
    desk: { obj: null, redir: null, fit: null },
    // IDER (mounted disk image) intentionally persists across tab switches so you can
    // mount an image, then move to Remote Desktop / Power to boot from it.
    iderSess: { obj: null, redir: null, timer: null },
    keyTarget: null, // 'term' | 'desk' | null

    // SOL/KVM redirection ports: 16994 (plain) / 16995 (TLS).
    redirPort: function (dev) { return dev.tls ? 16995 : 16994; },

    // Point a redirection module at the device using the live connection's credentials.
    startRedir: function (redir, obj, amt, dev) {
        redir.digestRealmMatch = obj.digestRealmMatch = amt.wsman.comm.digestRealm;
        redir.tlsv1only = obj.tlsv1only = amt.wsman.comm.tlsv1only;
        redir.Start(dev.host, Remote.redirPort(dev), amt.wsman.comm.user, amt.wsman.comm.pass, dev.tls ? 1 : 0);
    },

    detachFit: function () {
        if (Remote.desk.fit) { try { window.removeEventListener('resize', Remote.desk.fit); } catch (e) {} Remote.desk.fit = null; }
        if (Remote.desk.monitor) { try { clearInterval(Remote.desk.monitor); } catch (e) {} Remote.desk.monitor = null; }
    },

    stopIder: function () {
        try { if (Remote.iderSess.timer) clearInterval(Remote.iderSess.timer); } catch (e) {}
        try { if (Remote.iderSess.obj) Remote.iderSess.obj.Stop(); } catch (e) {}
        Remote.iderSess = { obj: null, redir: null, timer: null };
    },

    // Tear down every session (called on disconnect / device switch).
    stopAll: function () {
        try { if (Remote.term.redir) Remote.term.redir.Stop(); } catch (e) {}
        try { if (Remote.desk.redir) Remote.desk.redir.Stop(); } catch (e) {}
        Remote.stopIder();
        Remote.term = { obj: null, redir: null };
        Remote.desk = { obj: null, redir: null, fit: null };
        Remote.keyTarget = null;
        Remote.detachFit();
        document.onkeydown = document.onkeyup = document.onkeypress = null;
    },

    // Stop the session we're leaving when the user switches tabs.
    onTabChange: function (tab) {
        if (tab !== 'terminal' && Remote.term.redir) { try { Remote.term.redir.Stop(); } catch (e) {} Remote.term = { obj: null, redir: null }; }
        if (tab !== 'desktop' && Remote.desk.redir) { try { Remote.desk.redir.Stop(); } catch (e) {} Remote.desk = { obj: null, redir: null, fit: null }; Remote.detachFit(); }
        if (tab !== 'terminal' && tab !== 'desktop') Remote.keyTarget = null;
    }
};
