/* Serial-over-LAN — a VT100 terminal over the AMT redirection channel. */
Remote.terminal = function (c, amt, api) {
    var dev = api.device;

    // Power/boot shortcuts shown right in the console so you can reset the machine while
    // watching it boot over SOL (mirrors MeshCommander's Serial-over-LAN screen). Codes map
    // to app.js POWER_ACTIONS; confirmations for destructive ones are handled there.
    var TERM_POWER = [2, 8, 5, 10, 100, 101];
    var powerOpts = (api.powerActions || []).filter(function (a) { return TERM_POWER.indexOf(a.code) >= 0; })
        .map(function (a) { return '<option value="' + a.code + '">' + a.label + '</option>'; }).join('');
    var iderOk = !(api.conn && api.conn.caps && api.conn.caps.ider === false);

    c.innerHTML =
        '<div class="term-shell"><div class="term-bar">' +
        '<div class="btn sm primary" id="termConnect">Connect</div>' +
        '<span class="badge dot" id="termState">Disconnected</span>' +
        '<div class="spacer" style="flex:1"></div>' +
        '<select id="termPower" class="btn sm" title="Power or reset the machine while watching the console">' +
        '<option value="">Power…</option>' + powerOpts + '</select>' +
        (iderOk ? '<div class="btn sm" id="termIder" title="Mount an ISO/floppy and boot it (IDE-R)">Storage / IDER</div>' : '') +
        '<select id="termSize" class="btn sm"><option value="80x25">80 × 25</option><option value="100x30">100 × 30</option></select>' +
        '<div class="btn sm" id="termCad">Ctrl-Alt-Del</div>' +
        '<div class="btn sm" id="termPaste" title="Paste clipboard text into the console">Paste</div>' +
        '<div class="btn sm" id="termCapture" title="Start/stop recording the console; stopping downloads the log">Start Capture</div>' +
        '<div class="btn sm" id="termClear">Clear</div>' +
        '</div><div class="term-scroll" id="termScroll" tabindex="0"><div id="termContainer"></div></div></div>';

    var sizeSel = document.getElementById('termSize');
    var scroll = document.getElementById('termScroll');

    function isConnected() { return Remote.term.redir && Remote.term.redir.State === 3; }

    function build() {
        var dims = sizeSel.value.split('x');
        var obj = CreateAmtRemoteTerminal('termContainer', { width: parseInt(dims[0]), height: parseInt(dims[1]) });
        obj.lineFeed = '\r\n';
        obj.capture = null; // capture off by default; toggled by the Start/Stop Capture button (MeshCommander-style)
        var redir = CreateAmtRedirect(obj);
        redir.onStateChanged = function (sender, st) {
            var badge = document.getElementById('termState'); if (!badge) return;
            badge.textContent = Remote.STATE[st];
            badge.className = 'badge dot ' + (st === 3 ? 'good' : st === 0 ? '' : 'warn');
            document.getElementById('termConnect').textContent = st === 0 ? 'Connect' : 'Disconnect';
            if (st === 3) { Remote.keyTarget = 'term'; scroll.focus(); }
            if (st === 0 && obj.TermResetScreen) { obj.TermResetScreen(); obj.TermDraw(); }
        };
        Remote.term = { obj: obj, redir: redir };
    }

    function connect() {
        if (!Remote.term.redir || Remote.term.redir.State === 0) {
            if (!Remote.term.redir) build();
            Remote.startRedir(Remote.term.redir, Remote.term.obj, amt, dev);
        } else {
            Remote.term.redir.Stop(); Remote.keyTarget = null;
        }
    }

    document.getElementById('termConnect').addEventListener('click', connect);
    document.getElementById('termClear').addEventListener('click', function () { if (Remote.term.obj) { Remote.term.obj.TermResetScreen(); Remote.term.obj.TermDraw(); } });

    // Power/reset from the console: connect SOL first (so boot output is captured), then act.
    var powerSel = document.getElementById('termPower');
    if (powerSel) powerSel.addEventListener('change', function () {
        var code = parseInt(powerSel.value, 10);
        powerSel.value = '';
        if (isNaN(code) || !api.powerAction) return;
        if (!isConnected()) connect();
        // useSol: redirect the BIOS/POST console over SOL for this boot so it shows up here.
        api.powerAction(code, { useSol: true });
    });
    var iderBtn = document.getElementById('termIder');
    if (iderBtn) iderBtn.addEventListener('click', function () { Remote.iderPopup(amt, api); });

    // Paste clipboard text into the console (needs a secure context — works over HTTPS).
    document.getElementById('termPaste').addEventListener('click', function () {
        if (!isConnected()) { UI.toast('Not connected', 'Connect the console before pasting.', 'warn'); return; }
        if (!navigator.clipboard || !navigator.clipboard.readText) { UI.toast('Paste unavailable', 'Clipboard access needs an HTTPS connection.', 'warn'); return; }
        navigator.clipboard.readText().then(function (t) { if (t) Remote.term.obj.TermSendKeys(t); })
            .catch(function () { UI.toast('Paste blocked', 'The browser denied clipboard access.', 'warn'); });
    });

    // Start/Stop Capture (MeshCommander-style): start begins recording received console output;
    // stop downloads the captured log. Capture is pure logging — it records what already arrives,
    // it does not enable SOL data (see the keepalive-only WS frames when nothing is being sent).
    document.getElementById('termCapture').addEventListener('click', function () {
        var obj = Remote.term.obj; if (!obj) return;
        var btn = document.getElementById('termCapture');
        if (obj.capture == null) {
            obj.capture = '';
            btn.textContent = 'Stop Capture';
            btn.classList.add('primary');
            UI.toast('Capture started', 'Recording console output to a log.', 'good');
        } else {
            var log = obj.capture;
            obj.capture = null;
            btn.textContent = 'Start Capture';
            btn.classList.remove('primary');
            if (log) UI.download('sol-' + (dev.name || dev.host) + '.txt', log, 'text/plain');
            else UI.toast('Nothing captured', 'No console output was received while capturing.', 'warn');
        }
    });
    document.getElementById('termCad').addEventListener('click', function () { if (isConnected()) Remote.term.obj.TermSendKeys(String.fromCharCode(27) + '[3;5~'); });
    sizeSel.addEventListener('change', function () { if (Remote.term.obj) { var d = sizeSel.value.split('x'); Remote.term.obj.Init(parseInt(d[0]), parseInt(d[1])); } });

    // Route keyboard events to the terminal only while it is the active, connected view.
    // Input is driven from keydown: once keydown calls preventDefault() the (deprecated) keypress
    // event never fires, so Enter and printable characters must be sent here to reach the device.
    scroll.addEventListener('keydown', function (e) {
        if (Remote.keyTarget !== 'term' || !isConnected()) return;
        var obj = Remote.term.obj;
        if (e.key === 'Enter' || e.which === 13) { obj.TermSendKeys('\r'); e.preventDefault(); return; }   // CR, as serial/BIOS expect
        if (e.key && e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) { obj.TermSendKeys(e.key); e.preventDefault(); return; } // printable character
        if (obj.TermHandleKeyDown(e)) e.preventDefault();  // arrows, F-keys, Tab, Esc, Ctrl-combos, Home/End, …
    });
    scroll.addEventListener('keyup', function (e) { if (Remote.keyTarget === 'term' && isConnected()) Remote.term.obj.TermHandleKeyUp(e); });

    build();
    setTimeout(connect, 150);
};
