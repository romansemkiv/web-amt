/* KVM Remote Desktop — hardware KVM viewer with full toolbar and viewport scaling. */
(function () {
    function loadSettings() {
        var d = { bpp: 1, showmouse: true, limitFrameRate: false };
        try { var t = localStorage.getItem('webamt.desktop'); if (t) d = Object.assign(d, JSON.parse(t)); } catch (e) {}
        return d;
    }
    function saveSettings(d) { try { localStorage.setItem('webamt.desktop', JSON.stringify(d)); } catch (e) {} }

    Remote.desktop = function (c, amt, api) {
        var dev = api.device;
        var settings = loadSettings();
        var recording = false;

        c.innerHTML = toolbar() +
            '<div class="kvm-stage" id="kvmStage"><canvas id="kvmCanvas" width="640" height="400" tabindex="0"></canvas>' +
            '<div class="kvm-hint" id="kvmHint">Click <b>Connect</b> to start the remote desktop session.</div></div></div>';
        var stage = document.getElementById('kvmStage');
        var shell = c.querySelector('.kvm-shell');

        function isConnected() { return Remote.desk.redir && Remote.desk.redir.State === 3; }
        function obj() { return Remote.desk.obj; }
        function viewOnly() { var v = document.getElementById('kvmVO'); return v && v.checked; }

        // Scale the canvas element to fit the stage (aspect preserved). The KVM module
        // maps the pointer via offsetWidth/offsetHeight, so CSS sizing keeps clicks accurate.
        function fit() {
            var cv = document.getElementById('kvmCanvas'); if (!cv || !stage || !cv.width || !cv.height) return;
            var availW = stage.clientWidth - 20, availH = stage.clientHeight - 20;
            if (availW <= 0 || availH <= 0) return;
            var scale = Math.min(availW / cv.width, availH / cv.height);
            cv.style.width = Math.round(cv.width * scale) + 'px';
            cv.style.height = Math.round(cv.height * scale) + 'px';
        }
        Remote.desk.fit = fit;
        window.addEventListener('resize', fit);
        document.addEventListener('fullscreenchange', function () { setTimeout(fit, 60); });

        function applyLiveSettings() {
            if (!obj()) return;
            obj().showmouse = settings.showmouse;
            obj().frameRateDelay = settings.limitFrameRate ? 200 : 0;
        }

        // Ask the KVM module to make its next framebuffer request a full (non-incremental)
        // one — the reliable way to repaint a static POST/BIOS screen. Setting the flag lets
        // the module send it at the correct point in its request loop (no state-machine desync).
        function refreshScreen() { if (isConnected() && obj()) obj().fullRefreshPending = true; }

        function build() {
            var o = CreateAmtRemoteDesktop('kvmCanvas', stage);
            o.useRLE = true; o.bpp = settings.bpp; o.useZLib = false;
            o.onScreenSizeChange = function () { setTimeout(fit, 0); setTimeout(refreshScreen, 120); };
            // Count incoming video bytes so the toolbar can show whether frames are actually arriving.
            Remote.desk.bytesIn = 0;
            var pbd = o.ProcessBinaryData;
            if (pbd) o.ProcessBinaryData = function (d) { Remote.desk.bytesIn += (d && (d.byteLength || d.length)) || 0; return pbd.call(o, d); };
            Remote.desk.obj = o;
            applyLiveSettings();
            var redir = CreateAmtRedirect(o);
            redir.onStateChanged = onState;
            Remote.desk.redir = redir;
        }

        // While connected: force a full (non-incremental) frame each second so static screens
        // (BIOS/POST) keep painting, and report the incoming data rate + resolution so a truly
        // blank "no signal" phase is distinguishable from a stuck decoder.
        function startMonitor() {
            stopMonitor();
            var last = 0, idle = 0;
            Remote.desk.monitor = setInterval(function () {
                if (!isConnected()) return;
                var o = obj();
                var total = Remote.desk.bytesIn || 0, delta = total - last; last = total;
                // NOTE: no forced full refresh here — that would re-send the whole screen every
                // second and destroy the frame rate. Static screens are repainted by the engine's
                // empty-frame detector instead, so active/OS screens keep the fast incremental loop.
                var res = (o.width && o.height) ? (o.width + '×' + o.height) : 'no signal';
                var info = document.getElementById('kvmInfo');
                if (info) info.textContent = res + ' · ' + Math.round(delta / 1024) + ' KB/s';
                // Little/no data for several seconds => the device isn't outputting video for this screen.
                idle = delta < 1024 ? idle + 1 : 0;
                var hint = document.getElementById('kvmHint');
                if (hint) {
                    if (idle >= 4) { hint.style.display = ''; hint.innerHTML = 'Connected, but the device is sending no video for this screen.<br>This is common in early POST — it should appear once the BIOS or OS outputs video.'; }
                    else hint.style.display = 'none';
                }
            }, 1000);
        }
        function stopMonitor() { if (Remote.desk.monitor) { clearInterval(Remote.desk.monitor); Remote.desk.monitor = null; } }

        function onState(sender, st) {
            var badge = document.getElementById('kvmState'); if (!badge) return;
            badge.textContent = Remote.STATE[st];
            badge.className = 'badge dot ' + (st === 3 ? 'good' : st === 0 ? '' : 'warn');
            document.getElementById('kvmConnect').textContent = st === 0 ? 'Connect' : 'Disconnect';
            var hint = document.getElementById('kvmHint'); if (hint) hint.style.display = st === 3 ? 'none' : '';
            if (st === 3) {
                Remote.keyTarget = 'desk';
                if (!viewOnly()) grabInput(true);
                var cv = document.getElementById('kvmCanvas'); if (cv) cv.focus();
                setTimeout(fit, 60);
                startMonitor();
            }
            if (st === 0) {
                stopMonitor();
                var info = document.getElementById('kvmInfo'); if (info) info.textContent = '';
                // disconnectCode: 1 = session refused, 2/3 = redirection auth failed,
                // 4 = protocol error, 50000/50002 = set by the KVM decoder (see kvm.js).
                var code = sender.disconnectCode;
                if (code === 1) UI.toast('KVM refused', 'The device refused the session — KVM may be disabled or in use. Try "Enable KVM".', 'warn');
                else if (code === 2 || code === 3) UI.toast('KVM authentication failed', 'The redirection session was rejected — check the AMT credentials.', 'bad');
                else if (code === 4) UI.toast('KVM protocol error', 'Received an unexpected redirection message.', 'bad');
                else if (code === 50000) UI.toast('KVM unsupported', 'The device dropped the session during setup — KVM may be unsupported on this hardware.', 'warn');
                else if (code === 50002) UI.toast('KVM error', 'Display buffer too large for Intel AMT (lower the screen resolution).', 'bad');
            }
        }

        function grabInput(on) {
            try {
                if (on) { obj().GrabKeyInput(); obj().GrabMouseInput(); }
                else { obj().UnGrabKeyInput(); obj().UnGrabMouseInput(); }
            } catch (e) {}
        }

        async function connect() {
            if (Remote.desk.redir && Remote.desk.redir.State !== 0) { Remote.desk.redir.Stop(); Remote.keyTarget = null; return; }
            build();
            var r = await Amt.get(amt, 'IPS_KVMRedirectionSettingData');
            if (r.body) {
                obj().useZLib = !!r.body.ZlibControlSupported;
                // Remove the KVM session timeout so long sessions (watching a full boot, leaving
                // it open) don't get dropped after a few minutes. 0 = no timeout.
                if (r.body.SessionTimeout) {
                    try { await Amt.put(amt, 'IPS_KVMRedirectionSettingData', Object.assign({}, r.body, { SessionTimeout: 0 })); } catch (e) {}
                }
            }
            Remote.startRedir(Remote.desk.redir, obj(), amt, dev);
        }

        function enableKvm() {
            UI.progress(true);
            Amt.exec(amt, 'CIM_KVMRedirectionSAP', 'RequestStateChange', { RequestedState: 2 }).then(function (r) {
                UI.progress(false);
                if (r.status === 200 && (r.rv == null || r.rv === 0)) UI.toast('KVM enabled', 'The KVM redirection port is now enabled.', 'good');
                else UI.toast('Enable KVM', 'Request returned ' + (r.rvStr || r.status) + '. It may already be enabled.', 'warn');
            });
        }

        function sendSpecialKey() {
            if (!isConnected() || viewOnly()) return;
            var k = document.getElementById('kvmKeys').value;
            if (RemoteKeys[k]) obj().sendkey(RemoteKeys[k].seq);
        }

        function screenshot() {
            var cv = document.getElementById('kvmCanvas');
            if (!cv || !isConnected()) { UI.toast('Not connected', 'Connect first to capture the screen', 'warn'); return; }
            var name = 'kvm-' + Views.deviceBase() + '-' + UI.tstamp() + '.png';
            cv.toBlob(function (blob) { UI.download(name, blob); UI.toast('Screenshot saved', name, 'good'); }, 'image/png');
        }

        function toggleRecord() {
            var btn = document.getElementById('kvmRecord');
            if (!recording) {
                if (!isConnected()) { UI.toast('Not connected', 'Connect first to record', 'warn'); return; }
                if (obj().StartRecording && obj().StartRecording()) { recording = true; btn.classList.add('danger'); btn.innerHTML = Icons.svg('record', 13) + ' Stop'; UI.toast('Recording started', '', 'good'); }
                else UI.toast('Recording unavailable', '', 'warn');
            } else {
                recording = false; btn.classList.remove('danger'); btn.innerHTML = Icons.svg('record', 13) + ' Record';
                var data = obj().StopRecording ? obj().StopRecording() : null;
                if (data) { var name = 'kvm-' + Views.deviceBase() + '-' + UI.tstamp() + '.mcrec'; UI.downloadBytes(name, data.join('')); UI.toast('Recording saved', name, 'good'); }
            }
        }

        function settingsDialog() {
            UI.modal({
                title: 'Display Settings', okText: 'Apply',
                body: '<div class="field"><label>Color depth</label><select id="ds_bpp"><option value="1"' + (settings.bpp === 1 ? ' selected' : '') + '>8-bit (faster)</option><option value="2"' + (settings.bpp === 2 ? ' selected' : '') + '>16-bit (better quality)</option></select><div class="hint">Applied on the next connection.</div></div>' +
                    '<label class="check"><input type="checkbox" id="ds_cursor"' + (settings.showmouse ? ' checked' : '') + '> Show remote mouse cursor</label>' +
                    '<label class="check"><input type="checkbox" id="ds_fps"' + (settings.limitFrameRate ? ' checked' : '') + '> Limit frame rate (save bandwidth)</label>',
                onOk: function (m) {
                    settings.bpp = parseInt(m.querySelector('#ds_bpp').value);
                    settings.showmouse = m.querySelector('#ds_cursor').checked;
                    settings.limitFrameRate = m.querySelector('#ds_fps').checked;
                    saveSettings(settings); applyLiveSettings();
                    UI.toast('Settings saved', settings.bpp === 2 ? 'Reconnect to apply 16-bit color' : 'Applied', 'good');
                }
            });
        }

        function powerMenu() {
            var body = api.powerActions.map(function (a) { return '<div class="btn ' + (a.kind || '') + ' block" data-pa="' + a.code + '" style="margin-bottom:8px;justify-content:flex-start">' + Icons.svg(a.ic, 15) + '  ' + UI.esc(a.label) + '</div>'; }).join('');
            UI.modal({ title: 'Power Actions', okText: null, cancelText: 'Close', body: body, onShow: function (m) {
                m.querySelectorAll('[data-pa]').forEach(function (n) { n.addEventListener('click', function () { api.powerAction(parseInt(n.getAttribute('data-pa'))); var back = m.closest('.modal-back'); if (back) back.remove(); }); });
            } });
        }

        // ---- wire toolbar ----
        var on = function (id, fn) { document.getElementById(id).addEventListener('click', fn); };
        on('kvmConnect', connect);
        on('kvmEnable', enableKvm);
        on('kvmCad', function () { if (isConnected() && !viewOnly()) obj().sendcad(); });
        on('kvmSendKey', sendSpecialKey);
        on('kvmRefresh', function () { if (isConnected()) { refreshScreen(); UI.toast('Screen refreshed', '', 'good'); } });
        on('kvmRotate', function () { if (obj()) { obj().setRotation((obj().rotation + 1) % 4); setTimeout(fit, 0); } });
        on('kvmShot', screenshot);
        on('kvmRecord', toggleRecord);
        on('kvmFull', function () { if (!document.fullscreenElement) { if (shell.requestFullscreen) shell.requestFullscreen(); } else if (document.exitFullscreen) document.exitFullscreen(); });
        on('kvmSettings', settingsDialog);
        on('kvmPower', powerMenu);
        document.getElementById('kvmVO').addEventListener('change', function () { if (isConnected()) grabInput(!viewOnly()); });
        document.getElementById('kvmKeys').addEventListener('keydown', function (e) { e.stopPropagation(); });
    };

    function toolbar() {
        var keyOpts = Object.keys(RemoteKeys).map(function (k) { return '<option value="' + k + '">' + UI.esc(RemoteKeys[k].label) + '</option>'; }).join('');
        return '<div class="kvm-shell"><div class="kvm-bar">' +
            '<div class="btn sm primary" id="kvmConnect">Connect</div>' +
            '<span class="badge dot" id="kvmState">Disconnected</span>' +
            '<span id="kvmInfo" class="muted" style="font-size:12px;min-width:120px"></span>' +
            '<div class="kvm-sep"></div>' +
            '<div class="btn sm" id="kvmCad" title="Send Ctrl+Alt+Del">Ctrl-Alt-Del</div>' +
            '<select id="kvmKeys" class="btn sm" title="Special key combinations">' + keyOpts + '</select>' +
            '<div class="btn sm" id="kvmSendKey">Send</div>' +
            '<div class="kvm-sep"></div>' +
            '<label class="check kvm-vo" title="Watch without sending input"><input type="checkbox" id="kvmVO"> View only</label>' +
            '<div class="spacer" style="flex:1"></div>' +
            '<div class="btn sm" id="kvmRefresh" title="Force a full screen redraw (use if the screen is blank during POST/BIOS)">' + Icons.svg('arrowclockwise', 14) + ' Refresh</div>' +
            '<div class="btn sm" id="kvmRotate" title="Rotate the remote screen">' + Icons.svg('rotate', 14) + ' Rotate</div>' +
            '<div class="btn sm" id="kvmShot" title="Save a screenshot">' + Icons.svg('camera', 14) + ' Screenshot</div>' +
            '<div class="btn sm" id="kvmRecord" title="Record the session to a file">' + Icons.svg('record', 13) + ' Record</div>' +
            '<div class="btn sm" id="kvmFull" title="Full screen">' + Icons.svg('fullscreen', 14) + ' Full</div>' +
            '<div class="btn sm" id="kvmSettings" title="Display settings">' + Icons.svg('gearshape', 15) + '</div>' +
            '<div class="btn sm" id="kvmPower" title="Power actions">' + Icons.svg('power', 14) + ' Power</div>' +
            '<div class="btn sm" id="kvmEnable" title="Enable the KVM redirection port on the device">Enable KVM</div>' +
            '</div>';
    }
})();
