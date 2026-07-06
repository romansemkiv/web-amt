/**
 * App — application core: device store, connection lifecycle, tab routing, power control.
 * Views render into #content; Amt/Comp/UI provide the shared plumbing.
 */
var App = (function () {
    var state = { devices: [], activeId: null, conn: null, tab: 'dashboard' };
    var passwords = {}; // in-memory per device id; only persisted when device.savePass is set

    var TABS = [
        { id: 'dashboard', label: 'Dashboard', ic: 'gauge' },
        { id: 'hardware', label: 'Hardware', ic: 'cpu' },
        { id: 'events', label: 'Event Log', ic: 'list' },
        { id: 'audit', label: 'Audit Log', ic: 'shield' },
        { id: 'network', label: 'Network', ic: 'globe' },
        { id: 'users', label: 'User Accounts', ic: 'people' },
        { id: 'terminal', label: 'Serial Console', ic: 'terminal', cap: 'sol' },
        { id: 'desktop', label: 'Remote Desktop', ic: 'display', cap: 'kvm' },
        { id: 'ider', label: 'Storage', ic: 'disc', cap: 'ider' },
        { id: 'settings', label: 'Settings', ic: 'gearshape' },
        { id: 'explorer', label: 'WSMAN Explorer', ic: 'code' }
    ];

    // DMTF power states plus boot-to shortcuts (boot workflow ported from MeshCommander).
    var POWER_ACTIONS = [
        { code: 2, label: 'Power Up', ic: 'power', kind: 'good' },
        { code: 8, label: 'Power Down', ic: 'power', kind: 'danger', confirm: 'Power off the machine?' },
        { code: 5, label: 'Power Cycle', ic: 'arrowcycle', confirm: 'Power cycle the machine?' },
        { code: 10, label: 'Reset', ic: 'arrowclockwise', confirm: 'Reset the machine?' },
        { code: 100, label: 'Reset to BIOS Setup', ic: 'gearshape', boot: 'bios', confirm: 'Reset into BIOS setup?' },
        { code: 101, label: 'Power On to BIOS Setup', ic: 'gearshape', boot: 'bios' },
        { code: 400, label: 'Reset to PXE', ic: 'globe', boot: 'pxe', confirm: 'Reset and boot from PXE?' },
        { code: 401, label: 'Power On to PXE', ic: 'globe', boot: 'pxe' },
        // IDER boot codes — triggered from the Storage tab, hidden from the dashboard power row.
        { code: 200, label: 'Reset & boot Floppy (IDER)', ic: 'floppy', ider: true, confirm: 'Reset and boot from the mounted floppy image?' },
        { code: 202, label: 'Reset & boot CD (IDER)', ic: 'disc', ider: true, confirm: 'Reset and boot from the mounted CD image?' }
    ];

    // ---------- Device store ----------
    function newId() { return 'd' + Math.random().toString(36).substring(2, 9); }
    function getDevice(id) { return state.devices.filter(function (d) { return d.id === id; })[0] || null; }
    function currentDevice() { return getDevice(state.activeId); }

    function loadDevices() {
        try { state.devices = JSON.parse(localStorage.getItem('webamt.devices')) || []; } catch (e) { state.devices = []; }
        state.devices.forEach(function (d) { if (d.savePass && d.pass != null) passwords[d.id] = d.pass; });
    }
    function saveDevices() {
        var out = state.devices.map(function (d) {
            var c = { id: d.id, name: d.name, host: d.host, port: d.port, tls: d.tls, user: d.user, savePass: !!d.savePass };
            if (d.savePass) c.pass = passwords[d.id] || '';
            return c;
        });
        try { localStorage.setItem('webamt.devices', JSON.stringify(out)); } catch (e) {}
    }

    // ---------- Sidebar ----------
    function renderSidebar() {
        var host = document.getElementById('devList');
        if (!state.devices.length) {
            host.innerHTML = '<div style="padding:24px 14px;text-align:center;color:var(--text-faint);font-size:13px">No devices yet.<br>Click <b>＋</b> to add an Intel AMT machine.</div>';
            return;
        }
        host.innerHTML = state.devices.map(function (d) {
            var cls = 'dev' + (d.id === state.activeId ? ' active' : '');
            if (state.conn && state.conn.deviceId === d.id) cls += state.conn.connected ? ' on' : state.conn.error ? ' err' : ' busy';
            return '<div class="' + cls + '" data-id="' + d.id + '"><div class="dot"></div>' +
                '<div class="meta"><div class="name">' + UI.esc(d.name) + '</div>' +
                '<div class="host">' + UI.esc(d.host) + ':' + d.port + (d.tls ? ' 🔒' : '') + '</div></div>' +
                '<div class="edit" data-edit="' + d.id + '">✎</div></div>';
        }).join('');
        host.querySelectorAll('.dev').forEach(function (n) {
            n.addEventListener('click', function (e) {
                if (e.target.hasAttribute('data-edit')) editDeviceDialog(e.target.getAttribute('data-edit'));
                else selectDevice(n.getAttribute('data-id'));
            });
        });
    }

    // ---------- Device dialogs ----------
    function deviceForm(d) {
        d = d || { port: 16992, tls: false };
        return '<div class="field"><label>Friendly name</label><input id="f_name" value="' + UI.esc(d.name || '') + '" placeholder="Office PC"></div>' +
            '<div class="field-row"><div class="field" style="flex:2"><label>Hostname / IP</label><input id="f_host" value="' + UI.esc(d.host || '') + '" placeholder="192.168.1.50"></div>' +
            '<div class="field"><label>Port</label><input id="f_port" type="number" value="' + (d.port || 16992) + '"></div></div>' +
            '<div class="field-row"><div class="field"><label>Username</label><input id="f_user" value="' + UI.esc(d.user || 'admin') + '"></div>' +
            '<div class="field"><label>Password</label><input id="f_pass" type="password" value="' + UI.esc((d.id && passwords[d.id]) || '') + '"></div></div>' +
            '<label class="check"><input type="checkbox" id="f_tls"' + (d.tls ? ' checked' : '') + '> Use TLS (port 16993)</label>' +
            '<label class="check"><input type="checkbox" id="f_save"' + (d.savePass ? ' checked' : '') + '> Remember password in this browser</label>';
    }
    function readForm(m) {
        return {
            name: m.querySelector('#f_name').value.trim() || m.querySelector('#f_host').value.trim(),
            host: m.querySelector('#f_host').value.trim(),
            port: parseInt(m.querySelector('#f_port').value, 10) || 16992,
            user: m.querySelector('#f_user').value.trim(),
            pass: m.querySelector('#f_pass').value,
            tls: m.querySelector('#f_tls').checked,
            savePass: m.querySelector('#f_save').checked
        };
    }
    function addDeviceDialog() {
        UI.modal({ title: 'Add Intel AMT device', body: deviceForm(), okText: 'Add device', onOk: function (m) {
            var f = readForm(m); if (!f.host) { UI.toast('Missing host', 'Enter a hostname or IP', 'bad'); return false; }
            var id = newId();
            state.devices.push({ id: id, name: f.name, host: f.host, port: f.port, user: f.user, tls: f.tls, savePass: f.savePass });
            passwords[id] = f.pass; saveDevices(); renderSidebar(); selectDevice(id);
        } });
    }
    function editDeviceDialog(id) {
        var d = getDevice(id); if (!d) return;
        UI.modal({ title: 'Edit device', body: deviceForm(d), buttons: [
            { text: 'Delete', kind: 'danger', onClick: function () {
                UI.confirm('Delete device', 'Remove "' + d.name + '"?', 'Delete', 'danger').then(function (ok) {
                    if (!ok) return;
                    state.devices = state.devices.filter(function (x) { return x.id !== id; });
                    delete passwords[id]; saveDevices();
                    if (state.activeId === id) { state.activeId = null; disconnect(); renderTop(); }
                    renderSidebar();
                });
            } },
            { text: 'Cancel' },
            { text: 'Save', kind: 'primary', onClick: function (m) {
                var f = readForm(m); if (!f.host) return false;
                Object.assign(d, { name: f.name, host: f.host, port: f.port, user: f.user, tls: f.tls, savePass: f.savePass });
                passwords[id] = f.pass; saveDevices(); renderSidebar(); if (state.activeId === id) renderTop();
            } }
        ] });
    }

    // ---------- Connection ----------
    function selectDevice(id) {
        if (state.activeId === id && state.conn && state.conn.deviceId === id) { renderSidebar(); return; }
        disconnect();
        state.activeId = id;
        renderSidebar(); renderTop(); connect();
    }

    function connect() {
        var d = currentDevice(); if (!d) return;
        var pass = passwords[d.id];
        if (pass) { doConnect(d, pass); return; }
        UI.modal({
            title: 'Password for ' + d.name, okText: 'Connect',
            body: '<div class="field"><label>Intel AMT password for <b>' + UI.esc(d.user) + '</b></label><input id="f_p" type="password" autofocus></div>' +
                '<label class="check"><input type="checkbox" id="f_rem"> Remember for this session</label>',
            onOk: function (m) {
                var p = m.querySelector('#f_p').value; if (!p) return false;
                passwords[d.id] = p;
                if (m.querySelector('#f_rem').checked) { d.savePass = true; saveDevices(); }
                doConnect(d, p);
            }
        });
    }

    async function doConnect(d, pass) {
        UI.progress(true);
        state.conn = { deviceId: d.id, host: d.host, connected: false, error: false };
        var wsstack = WsmanStackCreateService(d.host, d.port, d.user, pass, d.tls ? 1 : 0);
        state.conn.wsstack = wsstack;
        state.conn.amt = AmtStackCreateService(wsstack);
        renderSidebar(); renderTop();

        // Probe a few core classes to validate authentication and read the AMT version.
        var res = await Amt.batch(state.conn.amt, ['*AMT_GeneralSettings', 'CIM_SoftwareIdentity', '*AMT_SetupAndConfigurationService', 'CIM_ServiceAvailableToElement', '*CIM_KVMRedirectionSAP', '*AMT_RedirectionService']);
        UI.progress(false);
        if (!state.conn || state.conn.deviceId !== d.id) return; // superseded by another selection

        var ok = res.map['AMT_GeneralSettings'] && res.map['AMT_GeneralSettings'].status === 200;
        if (ok) {
            state.conn.connected = true;
            state.conn.version = Amt.version(res.map);
            // Capability detection: hide a redirection tab when the platform lacks that feature.
            // KVM needs the Intel iGPU (absent on e.g. Xeon workstations) so its SAP won't be present;
            // SOL/IDER ride on the redirection service.
            var redir = !!Amt.pick(res.map, 'AMT_RedirectionService');
            state.conn.caps = {
                kvm: !!Amt.pick(res.map, 'CIM_KVMRedirectionSAP'),
                sol: redir,
                ider: redir
            };
            renderSidebar(); renderTop(); setTab(state.tab);
            UI.toast('Connected', d.name + ' is online', 'good');
        } else {
            state.conn.error = true;
            renderSidebar(); renderTop();
            showConnError(d, Amt.connError(res.status));
        }
    }

    function showConnError(d, msg) {
        var c = document.getElementById('content');
        c.className = 'content';
        c.innerHTML = '<div class="center-state"><div class="big">⚠️</div><h2>Unable to connect</h2><p>' + UI.esc(msg) + '</p>' +
            '<div class="btn-row" style="justify-content:center"><div class="btn primary" id="retryBtn">Retry</div><div class="btn" id="editBtn">Edit device</div></div></div>';
        document.getElementById('retryBtn').addEventListener('click', connect);
        document.getElementById('editBtn').addEventListener('click', function () { editDeviceDialog(d.id); });
    }

    function disconnect() {
        if (state.conn) {
            try { Remote.stopAll(); } catch (e) {}
            try { if (state.conn.amt) state.conn.amt.CancelAllQueries(999); } catch (e) {}
        }
        state.conn = null;
    }

    // ---------- Top bar & tabs ----------
    function renderTop() {
        var d = currentDevice();
        var el = { title: 'tbTitle', sub: 'tbSub', btn: 'btnConnect', power: 'tbPower', conn: 'tbConn', tabs: 'tabs' };
        var g = function (k) { return document.getElementById(el[k]); };
        if (!d) {
            g('title').textContent = 'No device selected';
            g('sub').textContent = 'Add or select an Intel AMT device to begin';
            ['btn', 'power', 'conn', 'tabs'].forEach(function (k) { g(k).style.display = 'none'; });
            return;
        }
        var connected = state.conn && state.conn.connected;
        g('title').textContent = d.name;
        g('sub').textContent = d.host + ':' + d.port + (state.conn && state.conn.version ? '  ·  AMT ' + AmtData.parseAmtVersion(state.conn.version) : '');
        g('conn').style.display = '';
        g('conn').className = 'badge dot ' + (connected ? 'good' : state.conn && state.conn.error ? 'bad' : 'warn');
        g('conn').textContent = connected ? 'Connected' : state.conn && state.conn.error ? 'Error' : 'Connecting…';
        g('btn').style.display = '';
        g('btn').textContent = connected ? 'Reconnect' : 'Connect';
        g('btn').onclick = function () { disconnect(); renderSidebar(); connect(); };
        updatePowerBadge();
        g('tabs').style.display = connected ? 'flex' : 'none';
        if (connected) renderTabs();
    }

    function updatePowerBadge() {
        var pw = document.getElementById('tbPower');
        if (!state.conn || !state.conn.connected || state.conn.sysstate == null) { pw.style.display = 'none'; return; }
        var ps = AmtData.powerState(state.conn.sysstate);
        pw.style.display = '';
        pw.className = 'badge dot ' + (ps[1] === 'on' ? 'good' : ps[1] === 'sleep' ? 'warn' : '');
        pw.textContent = ps[0];
    }
    function setSysState(v) { if (state.conn) { state.conn.sysstate = v; updatePowerBadge(); } }

    // Tabs the connected device actually supports. A tab with a `cap` is hidden only
    // when we positively determined the device lacks it (caps present and that flag false).
    function visibleTabs() {
        var caps = state.conn && state.conn.caps;
        return TABS.filter(function (t) {
            if (!t.cap || !caps) return true;
            return caps[t.cap] !== false;
        });
    }

    function renderTabs() {
        var el = document.getElementById('tabs');
        el.innerHTML = visibleTabs().map(function (t) {
            return '<div class="tab' + (t.id === state.tab ? ' active' : '') + '" data-tab="' + t.id + '"><span class="ic">' + Icons.svg(t.ic, 16) + '</span>' + t.label + '</div>';
        }).join('');
        el.querySelectorAll('.tab').forEach(function (n) { n.addEventListener('click', function () { setTab(n.getAttribute('data-tab')); }); });
    }

    function setTab(id) {
        // If a hidden/unsupported tab is requested (e.g. a remembered tab), fall back to the dashboard.
        if (!visibleTabs().some(function (t) { return t.id === id; })) id = 'dashboard';
        state.tab = id;
        renderTabs();
        if (!state.conn || !state.conn.connected) return;
        Remote.onTabChange(id);
        var c = document.getElementById('content');
        c.className = 'content' + (id === 'terminal' || id === 'desktop' ? ' nopad' : '');
        var view = Views[id] || Views.dashboard;
        try { view(c, state.conn.amt, api()); }
        catch (e) { c.innerHTML = '<div class="center-state"><div class="big">💥</div><h2>View error</h2><p>' + UI.esc(e.message) + '</p></div>'; console.error(e); }
    }

    // ---------- Power control ----------
    async function powerAction(code) {
        var amt = state.conn && state.conn.amt; if (!amt) return;
        var meta = POWER_ACTIONS.filter(function (a) { return a.code === code; })[0];
        if (meta && meta.confirm) { var ok = await UI.confirm(meta.label, meta.confirm, meta.label, meta.kind === 'danger' ? 'danger' : 'primary'); if (!ok) return; }

        UI.progress(true);
        UI.toast('Power action', 'Applying boot settings…');
        try {
            var boot = await Amt.get(amt, 'AMT_BootSettingData');
            if (boot.status !== 200) throw new Error('Could not read boot settings (' + boot.status + ')');
            var r = applyBootSettings(boot.body, code);

            await step(Amt.call(amt, 'CIM_BootConfigSetting_ChangeBootOrder', null), 'ChangeBootOrder');   // clear order
            await step(Amt.put(amt, 'AMT_BootSettingData', r), 'Put BootSettingData');                      // write settings
            await step(Amt.call(amt, 'SetBootConfigRole', 1), 'SetBootConfigRole');                          // use next boot
            var src = meta && meta.boot === 'pxe' ? amt.BootSourceRef('Force PXE Boot') : null;
            await step(Amt.call(amt, 'CIM_BootConfigSetting_ChangeBootOrder', src), 'ChangeBootOrder(2)');   // set source

            var change = await Amt.call(amt, 'RequestPowerStateChange', dmtfCode(code));
            UI.progress(false);
            if (change.status === 200 && change.body && change.body.ReturnValue === 0) {
                UI.toast('Power action completed', (meta ? meta.label : 'Action') + ' sent', 'good');
                setTimeout(refreshPower, 2500);
            } else {
                UI.toast('Power action failed', (change.body && change.body.ReturnValueStr) || ('status ' + change.status), 'bad');
            }
        } catch (err) {
            UI.progress(false);
            UI.toast('Power action failed', err.message, 'bad');
        }
    }
    function step(promise, label) { return promise.then(function (r) { if (r.status !== 200) throw new Error(label + ' ' + r.status); return r; }); }
    function dmtfCode(code) {
        if (code === 100 || code === 400 || code === 200 || code === 202) return 10; // reset variants
        if (code === 101 || code === 401 || code === 201 || code === 203) return 2;  // power-on variants
        return code;
    }

    // Normalise AMT_BootSettingData for a Put: drop read-only fields, set the boot flags.
    function applyBootSettings(r, code) {
        ['WinREBootEnabled', 'UEFILocalPBABootEnabled', 'UEFIHTTPSBootEnabled', 'SecureBootControlEnabled', 'BootguardStatus', 'OptionsCleared', 'BIOSLastStatus', 'UefiBootParametersArray', 'RPEEnabled'].forEach(function (k) { delete r[k]; });
        var ider = (code >= 200 && code < 300);
        Object.assign(r, {
            BIOSPause: false, EnforceSecureBoot: false, BIOSSetup: (code === 100 || code === 101),
            BootMediaIndex: 0, FirmwareVerbosity: 0, ForcedProgressEvents: false,
            UseIDER: ider, IDERBootDevice: (code === 202 || code === 203) ? 1 : 0, // 1 = CD, 0 = floppy
            LockKeyboard: false, LockPowerButton: false, LockResetButton: false, LockSleepButton: false,
            ReflashBIOS: false, UseSOL: false, UseSafeMode: false, UserPasswordBypass: false
        });
        if (r.ConfigurationDataReset != null) r.ConfigurationDataReset = false;
        if (r.SecureErase != null) r.SecureErase = false;
        return r;
    }

    function refreshPower() {
        var amt = state.conn && state.conn.amt; if (!amt) return;
        Amt.enum(amt, 'CIM_ServiceAvailableToElement').then(function (r) {
            if (r.status === 200 && r.items.length && r.items[0].PowerState != null) {
                setSysState(r.items[0].PowerState);
                if (Views.onPowerRefresh) Views.onPowerRefresh(r.items[0].PowerState);
            }
        });
    }

    // ---------- API handed to views ----------
    function api() {
        return { device: currentDevice(), conn: state.conn, powerActions: POWER_ACTIONS, powerAction: powerAction, refreshPower: refreshPower, setSysState: setSysState, setTab: setTab };
    }

    // ---------- Device import / export ----------
    function exportDevices() {
        var data = state.devices.map(function (d) { return { name: d.name, host: d.host, port: d.port, user: d.user, tls: d.tls }; });
        UI.download('webamt-devices.json', JSON.stringify(data, null, 2), 'application/json');
    }
    function importDevices() {
        var input = document.createElement('input'); input.type = 'file'; input.accept = '.json';
        input.onchange = function () {
            var f = input.files[0]; if (!f) return;
            var reader = new FileReader();
            reader.onload = function () {
                try {
                    var n = 0;
                    JSON.parse(reader.result).forEach(function (d) {
                        if (d.host) { state.devices.push({ id: newId(), name: d.name || d.host, host: d.host, port: d.port || 16992, user: d.user || 'admin', tls: !!d.tls }); n++; }
                    });
                    saveDevices(); renderSidebar(); UI.toast('Imported', n + ' device(s) added', 'good');
                } catch (e) { UI.toast('Import failed', 'Invalid JSON', 'bad'); }
            };
            reader.readAsText(f);
        };
        input.click();
    }

    // ---------- Bootstrap ----------
    function init() {
        Views.terminal = Remote.terminal; // redirection viewers live on Remote; expose as tabs
        Views.desktop = Remote.desktop;
        Views.ider = Remote.ider;
        loadDevices();
        renderSidebar();
        renderTop();
        document.documentElement.setAttribute('data-theme', localStorage.getItem('webamt.theme') || 'dark');
        // SF-style icons for the static sidebar controls
        document.getElementById('btnAddDevice').innerHTML = Icons.svg('plus', 16);
        document.getElementById('btnTheme').innerHTML = Icons.svg('moon', 14) + ' Theme';
        document.getElementById('btnExport').innerHTML = Icons.svg('download', 15);
        document.getElementById('btnImport').innerHTML = Icons.svg('upload', 15);
        document.getElementById('btnAddDevice').addEventListener('click', addDeviceDialog);
        document.getElementById('btnTheme').addEventListener('click', function () {
            var t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', t); localStorage.setItem('webamt.theme', t);
        });
        document.getElementById('btnExport').addEventListener('click', exportDevices);
        document.getElementById('btnImport').addEventListener('click', importDevices);
        if (!state.devices.length) {
            document.getElementById('content').innerHTML =
                '<div class="center-state"><div class="big">🖥️</div><h2>Welcome to WebAMT</h2>' +
                '<p>A modern, browser-based console for managing Intel&reg; AMT / vPro machines. Add a device to get started — power control, hardware inventory, event logs, serial console (SOL), and KVM remote desktop all run right here in your browser.</p>' +
                '<div class="btn primary" onclick="App.addDeviceDialog()">＋ Add your first device</div></div>';
        }
        // Poll power state while the dashboard is open.
        setInterval(function () { if (state.conn && state.conn.connected && state.tab === 'dashboard') refreshPower(); }, 15000);
    }

    // Public surface: bootstrap, the two entry points referenced from markup / other
    // modules (addDeviceDialog via the welcome button, currentDevice from views).
    return { init: init, addDeviceDialog: addDeviceDialog, currentDevice: currentDevice };
})();

document.addEventListener('DOMContentLoaded', App.init);
