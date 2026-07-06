/* Dashboard — live power state + system/management overview. */
(function () {
    var DASH_CLASSES = ['*AMT_GeneralSettings', '*AMT_SetupAndConfigurationService', 'CIM_SoftwareIdentity',
        '*CIM_ComputerSystemPackage', '*AMT_RedirectionService', '*CIM_KVMRedirectionSAP',
        '*IPS_KVMRedirectionSettingData', '*IPS_OptInService'];

    Views.dashboard = function (c, amt, api) {
        c.innerHTML = Comp.heading('Dashboard', 'Live power state and system overview.') +
            '<div id="dashPower"></div><div id="dashCards" style="margin-top:16px">' + UI.spinner() + '</div>';
        renderPowerPanel(document.getElementById('dashPower'), api);
        api.refreshPower();
        load(c, amt, api);
    };

    async function load(c, amt, api) {
        var map = (await Amt.batch(amt, DASH_CLASSES)).map;
        var host = document.getElementById('dashCards'); if (!host) return;

        var gs = Amt.pick(map, 'AMT_GeneralSettings');
        var scs = Amt.pick(map, 'AMT_SetupAndConfigurationService');
        var pkg = Amt.pick(map, 'CIM_ComputerSystemPackage');
        var ver = Amt.version(map);
        var uuid = pkg && pkg.PlatformGUID ? AmtData.uuidFromHex(pkg.PlatformGUID) : null;
        var provState = scs ? AmtData.provisioningState(scs.ProvisioningState) : null;
        var mode = scs && scs.ProvisioningMode ? AmtData.provisioningMode(scs.ProvisioningMode) : null;

        host.innerHTML =
            '<div class="grid cols-3">' +
                Comp.stat('Intel AMT Version', ver || '—', 'chip') +
                Comp.stat('Provisioning', provState || '—', 'lock') +
                Comp.stat('Host Name', gs && gs.HostName ? Comp.esc(gs.HostName) : '—', 'tag') +
            '</div>' +
            '<div class="grid cols-2" style="margin-top:16px">' +
                Comp.card({ title: 'System Identity', actions: gs ? '<div class="btn sm" id="editNameBtn">' + Icons.svg('pencil', 14) + ' Edit name</div>' : '', body: Comp.kv([
                    ['Friendly name', Comp.esc(api.device.name)],
                    ['Host / IP', Comp.esc(api.device.host) + ':' + api.device.port],
                    ['AMT host name', gs ? Comp.esc(gs.HostName) : null],
                    ['Domain', gs ? Comp.esc(gs.DomainName) : null],
                    ['Unique ID (UUID)', uuid, true],
                    ['Provisioning mode', mode]
                ]) }) +
                Comp.card({ title: 'Management', body: Comp.kv([
                    ['AMT version', ver],
                    ['Network enabled', gs ? Comp.boolBadge(gs.AMTNetworkEnabled !== 0) : null],
                    ['Digest realm', gs ? Comp.esc(gs.DigestRealm) : null, true],
                    ['Ping response', gs ? Comp.boolBadge(gs.PingResponseEnabled) : null],
                    ['Power source', gs && gs.PowerSource != null ? (gs.PowerSource === 0 ? 'AC' : 'Battery') : null]
                ]) }) +
            '</div>' +
            '<div class="grid cols-2" style="margin-top:16px">' +
                Comp.card({ title: 'Management Features', body: Comp.kv([
                    ['Active features', activeFeatures(map)],
                    ['Remote desktop', remoteDesktopText(map)],
                    ['User consent', userConsent(map)],
                    ['Date &amp; time', '<span id="amtClock" class="muted">reading…</span>']
                ]) }) +
                Comp.card({ title: 'Provisioning', body: Comp.kv([
                    ['State', provState],
                    ['Control mode', mode],
                    ['Zero-touch config', scs && scs.ZeroTouchConfigurationEnabled != null ? Comp.boolBadge(scs.ZeroTouchConfigurationEnabled) : null]
                ]) }) +
            '</div>';

        var editBtn = document.getElementById('editNameBtn');
        if (editBtn && gs) editBtn.addEventListener('click', function () { editComputerName(amt, gs, function () { Views.dashboard(c, amt, api); }); });

        // Date & time from the AMT clock (Ta0 = seconds since epoch).
        var t = await Amt.call(amt, 'AMT_TimeSynchronizationService_GetLowAccuracyTimeSynch');
        var clock = document.getElementById('amtClock');
        if (clock) {
            if (t.status === 200 && t.body && t.body.Ta0) { clock.className = ''; clock.textContent = new Date(parseInt(t.body.Ta0) * 1000).toLocaleString(); }
            else { clock.textContent = '—'; }
        }
    }

    function activeFeatures(map) {
        var redir = Amt.pick(map, 'AMT_RedirectionService');
        var kvmsap = Amt.pick(map, 'CIM_KVMRedirectionSAP');
        var feats = [];
        if (redir) {
            if (redir.ListenerEnabled === true) feats.push('Redirection Port');
            if ((parseInt(redir.EnabledState) & 2) !== 0) feats.push('Serial-over-LAN');
            if ((parseInt(redir.EnabledState) & 1) !== 0) feats.push('IDE-Redirect');
        }
        if (kvmsap) { var ke = parseInt(kvmsap.EnabledState); if (ke === 2 || ke === 6) feats.push('KVM'); }
        return feats.length ? feats.map(function (f) { return Comp.badge(f, 'good'); }).join(' ') : '<span class="muted">None</span>';
    }

    function remoteDesktopText(map) {
        var s = Amt.pick(map, 'IPS_KVMRedirectionSettingData');
        if (!s) return '<span class="muted">Not supported</span>';
        var txt = ['Primary display', 'Secondary display', '3rd display'][s.DefaultScreen] || 'Primary display';
        if (s.Is5900PortEnabled === true) txt += ', Port 5900 enabled';
        if (s.SessionTimeout != null) txt += ', ' + s.SessionTimeout + ' minute' + (s.SessionTimeout == 1 ? '' : 's') + ' session timeout';
        return Comp.esc(txt);
    }

    function userConsent(map) {
        var o = Amt.pick(map, 'IPS_OptInService');
        if (!o || o.OptInRequired == null) return null;
        var v = o.OptInRequired;
        return v === 0 ? 'Not required' : v === 1 ? 'Required for KVM only' : (v === 0xFFFFFFFF || v === -1) ? 'Always required' : ('Code ' + v);
    }

    // ---- Power hero ----
    function renderPowerPanel(host, api) {
        var ps = api.conn.sysstate ? AmtData.powerState(api.conn.sysstate) : ['Querying…', 'off'];
        var actions = api.powerActions.filter(function (a) { return !a.ider; }).map(function (a) {
            return '<div class="btn ' + (a.kind || '') + '" data-pa="' + a.code + '">' + Icons.svg(a.ic, 15) + ' ' + Comp.esc(a.label) + '</div>';
        }).join('');
        host.innerHTML = Comp.card({ body:
            '<div class="power-hero"><div class="power-orb ' + orbClass(ps[1]) + '" id="powerOrb">⏻</div>' +
            '<div style="flex:1"><div class="muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.6px">Power state</div>' +
            '<div style="font-size:26px;font-weight:700" id="powerLabel">' + Comp.esc(ps[0]) + '</div>' +
            '<div class="btn-row" style="margin-top:14px">' + actions + '</div></div></div>'
        });
        host.querySelectorAll('[data-pa]').forEach(function (n) {
            n.addEventListener('click', function () { api.powerAction(parseInt(n.getAttribute('data-pa'), 10)); });
        });
    }
    function orbClass(cls) { return cls === 'on' ? 'on' : cls === 'sleep' ? 'sleep' : 'off'; }

    // Called by App after a power poll to live-update the hero without re-rendering.
    Views.onPowerRefresh = function (ps) {
        var orb = document.getElementById('powerOrb'), lbl = document.getElementById('powerLabel');
        if (!orb || !lbl) return;
        var s = AmtData.powerState(ps);
        orb.className = 'power-orb ' + orbClass(s[1]);
        lbl.textContent = s[0];
    };

    // ---- Edit computer name (Put AMT_GeneralSettings) ----
    function editComputerName(amt, gs, done) {
        var full = gs.HostName + (gs.DomainName ? '.' + gs.DomainName : '');
        UI.modal({
            title: 'Computer Name', okText: 'Save',
            body: '<div class="field"><label>Host name and domain (host.domain)</label><input id="gn" value="' + Comp.esc(full) + '"></div>' +
                '<div class="field"><label>Name sharing</label><select id="gsShare"><option value="true"' + (gs.SharedFQDN ? ' selected' : '') + '>Shared — same as OS</option><option value="false"' + (!gs.SharedFQDN ? ' selected' : '') + '>Dedicated — different from OS</option></select></div>',
            onOk: function (m) {
                var v = m.querySelector('#gn').value.trim(); if (!v) return false;
                var dot = v.indexOf('.'), host = dot >= 0 ? v.substring(0, dot) : v, dom = dot >= 0 ? v.substring(dot + 1) : '';
                var clone = Object.assign({}, gs, { HostName: host, DomainName: dom, SharedFQDN: m.querySelector('#gsShare').value === 'true' });
                UI.progress(true);
                Amt.put(amt, 'AMT_GeneralSettings', clone).then(function (r) {
                    UI.progress(false);
                    if (r.status === 200) { UI.toast('Saved', 'Computer name updated', 'good'); if (done) done(); }
                    else UI.toast('Save failed', Amt.wsErr(r.resp, r.status), 'bad');
                });
            }
        });
    }
})();
