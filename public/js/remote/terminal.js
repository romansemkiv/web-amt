/* Serial-over-LAN — a VT100 terminal over the AMT redirection channel. */
Remote.terminal = function (c, amt, api) {
    var dev = api.device;
    c.innerHTML =
        '<div class="term-shell"><div class="term-bar">' +
        '<div class="btn sm primary" id="termConnect">Connect</div>' +
        '<span class="badge dot" id="termState">Disconnected</span>' +
        '<div class="spacer" style="flex:1"></div>' +
        '<select id="termSize" class="btn sm"><option value="80x25">80 × 25</option><option value="100x30">100 × 30</option></select>' +
        '<div class="btn sm" id="termCad">Ctrl-Alt-Del</div>' +
        '<div class="btn sm" id="termClear">Clear</div>' +
        '</div><div class="term-scroll" id="termScroll" tabindex="0"><div id="termContainer"></div></div></div>';

    var sizeSel = document.getElementById('termSize');
    var scroll = document.getElementById('termScroll');

    function isConnected() { return Remote.term.redir && Remote.term.redir.State === 3; }

    function build() {
        var dims = sizeSel.value.split('x');
        var obj = CreateAmtRemoteTerminal('termContainer', { width: parseInt(dims[0]), height: parseInt(dims[1]) });
        obj.lineFeed = '\r\n';
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
    document.getElementById('termCad').addEventListener('click', function () { if (isConnected()) Remote.term.obj.TermSendKeys(String.fromCharCode(27) + '[3;5~'); });
    sizeSel.addEventListener('change', function () { if (Remote.term.obj) { var d = sizeSel.value.split('x'); Remote.term.obj.Init(parseInt(d[0]), parseInt(d[1])); } });

    // Route keyboard events to the terminal only while it is the active, connected view.
    scroll.addEventListener('keydown', function (e) { if (Remote.keyTarget === 'term' && isConnected()) { if (Remote.term.obj.TermHandleKeyDown(e)) e.preventDefault(); } });
    scroll.addEventListener('keypress', function (e) { if (Remote.keyTarget === 'term' && isConnected()) { Remote.term.obj.TermHandleKeys(e); e.preventDefault(); } });
    scroll.addEventListener('keyup', function (e) { if (Remote.keyTarget === 'term' && isConnected()) Remote.term.obj.TermHandleKeyUp(e); });

    build();
    setTimeout(connect, 150);
};
