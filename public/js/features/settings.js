/* Settings — enable/disable AMT features (SOL, IDER, KVM, listener), user-consent policy,
 * and Client Initiated Remote Access (CIRA): configure the connected device to dial into
 * WebAMT's built-in MPS. */
(function () {
    var SET_CLASSES = ['*AMT_RedirectionService', '*CIM_KVMRedirectionSAP', '*IPS_OptInService'];

    Views.settings = function (c, amt) {
        Comp.loading(c, 'Reading Intel AMT features…');
        load(c, amt);
    };

    async function load(c, amt) {
        var map = (await Amt.batch(amt, SET_CLASSES)).map;
        var redir = Amt.pick(map, 'AMT_RedirectionService');
        var kvm = Amt.pick(map, 'CIM_KVMRedirectionSAP');
        var optin = Amt.pick(map, 'IPS_OptInService');
        if (!redir) { c.innerHTML = Comp.errState('Settings unavailable', 'Could not read the redirection service.'); return; }
        var cira = await fetchCira();

        var es = parseInt(redir.EnabledState); // 32768 + ider(1) + sol(2)
        var featuresBody = Comp.toggle('set_listen', 'Redirection port (listener)', redir.ListenerEnabled === true) +
            Comp.toggle('set_sol', 'Serial-over-LAN (SOL)', (es & 2) !== 0) +
            Comp.toggle('set_ider', 'IDE Redirection (IDER)', (es & 1) !== 0) +
            (kvm ? Comp.toggle('set_kvm', 'KVM Remote Desktop', parseInt(kvm.EnabledState) === 6) : '<p class="muted" style="margin:10px 0 0">KVM is not supported on this device.</p>') +
            '<div class="btn primary" id="saveFeatures" style="margin-top:16px">Save features</div>';

        var optval = optin ? optin.OptInRequired : null;
        function opt(v, label) { return '<option value="' + v + '"' + (optval === v ? ' selected' : '') + '>' + label + '</option>'; }
        var consentBody = '<div class="field"><label>Require user consent for KVM/redirection</label><select id="set_optin">' +
            opt(0, 'None — no consent needed') + opt(1, 'KVM only') + opt(0xFFFFFFFF, 'All (KVM, SOL, IDER)') + '</select>' +
            '<div class="hint">Controls whether a code shown on the remote screen must be entered before a session starts.</div></div>' +
            '<div class="btn" id="saveOptin" style="margin-top:8px">Save consent policy</div>';

        c.innerHTML = Comp.heading('Settings', 'Enable or disable Intel AMT management features.') +
            '<div class="grid cols-2">' +
                Comp.card({ title: 'Redirection Features', body: featuresBody }) +
                Comp.card({ title: 'User Consent (opt-in)', body: consentBody }) +
            '</div>' +
            Comp.card({ title: 'Remote Access (CIRA)', body: ciraBody(cira) });

        document.getElementById('saveFeatures').addEventListener('click', function () { saveFeatures(c, amt, redir, kvm != null); });
        document.getElementById('saveOptin').addEventListener('click', function () { saveConsent(amt, optin); });
        wireCira(c, amt, cira);
    }

    // ---------------- CIRA (Client Initiated Remote Access) ----------------

    // Read the MPS parameters from our own server (cert to trust, its CN, the port).
    function fetchCira() {
        var base = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
        return fetch(base + 'api/cira').then(function (r) { return r.json(); }).catch(function () { return null; });
    }

    function ciraBody(cira) {
        if (!cira || !cira.enabled) {
            return '<p class="muted" style="margin:0">The WebAMT MPS listener is not running. Start the server with <code>--mps --mps-user &lt;name&gt; --mps-pass &lt;secret&gt;</code> to configure this device to dial in over CIRA.</p>';
        }
        var host = window.location.hostname || '';
        var port = cira.port || 4433;
        return '<p class="muted" style="margin:0 0 14px">Configure this device to dial into WebAMT’s MPS over TLS. The server certificate' +
            (cira.cn ? ' (CN <b>' + Comp.esc(cira.cn) + '</b>)' : '') + ' is added to the device as a trusted root automatically.</p>' +
            '<div class="field-row"><div class="field" style="flex:2"><label>MPS address (this server, as the device reaches it)</label><input id="cira_host" value="' + Comp.esc(host) + '" placeholder="mps.example.com or 203.0.113.5"></div>' +
            '<div class="field"><label>Port</label><input id="cira_port" type="number" value="' + port + '"></div></div>' +
            '<div class="field-row"><div class="field"><label>MPS username</label><input id="cira_user" value="admin" maxlength="16"></div>' +
            '<div class="field"><label>MPS password</label><input id="cira_pass" type="password" maxlength="16" placeholder="matches --mps-pass"></div></div>' +
            '<div class="field-row"><div class="field"><label>Connect trigger</label><select id="cira_trigger"><option value="2" selected>Periodic (stay connected)</option><option value="0">User initiated</option></select></div>' +
            '<div class="field" id="cira_interval_box"><label>Interval (seconds)</label><input id="cira_interval" type="number" value="30" min="10"></div></div>' +
            '<div class="field"><label>Environment detection domain</label><input id="cira_domain" value="cira.local" placeholder="cira.local">' +
            '<div class="hint">AMT uses CIRA only when its network DNS suffix does <b>not</b> match this. Use a domain your LAN never assigns (e.g. <code>cira.local</code>) to always dial in, or your corporate suffix to dial in only when off-site.</div></div>' +
            '<div class="hint" style="margin-bottom:12px">Username and password must match the server’s <code>--mps-user</code> / <code>--mps-pass</code> (max 16 chars; AMT requires a strong password).</div>' +
            '<div class="btn-row"><div class="btn primary" id="cira_apply">Configure device for CIRA</div>' +
            '<div class="btn" id="cira_remove">Remove CIRA configuration</div></div>';
    }

    function wireCira(c, amt, cira) {
        if (!cira || !cira.enabled) return;
        var trig = document.getElementById('cira_trigger');
        var ibox = document.getElementById('cira_interval_box');
        function syncInterval() { ibox.style.display = (trig.value === '2') ? '' : 'none'; }
        trig.addEventListener('change', syncInterval); syncInterval();
        document.getElementById('cira_apply').addEventListener('click', function () { configureCira(c, amt, cira); });
        document.getElementById('cira_remove').addEventListener('click', function () { removeCira(amt); });
    }

    // Remove all MPS servers and remote-access policies from the device.
    async function removeCira(amt) {
        var ok = await UI.confirm('Remove CIRA configuration',
            'Delete all MPS servers and remote-access policies from this device? It will stop dialing into the MPS.', 'Remove', 'danger');
        if (!ok) return;
        var steps = [];
        UI.progress(true);
        try {
            // Policies first — they reference the MPS servers via an association.
            var pols = (await Amt.enum(amt, 'AMT_RemoteAccessPolicyRule')).items || [];
            var pOk = 0, pFail = 0;
            for (var i = 0; i < pols.length; i++) {
                var rp = await Amt.call(amt, 'Delete', 'AMT_RemoteAccessPolicyRule', keySel(pols[i], 'PolicyRuleName'));
                if (rp.status === 200) pOk++; else pFail++;
            }
            steps.push([pOk + ' policy rule(s) removed' + (pFail ? ', ' + pFail + ' failed' : ''), pFail === 0]);

            var saps = (await Amt.enum(amt, 'AMT_ManagementPresenceRemoteSAP')).items || [];
            var sOk = 0, sFail = 0;
            for (i = 0; i < saps.length; i++) {
                var rs = await Amt.call(amt, 'Delete', 'AMT_ManagementPresenceRemoteSAP', keySel(saps[i], 'Name'));
                if (rs.status === 200) sOk++; else sFail++;
            }
            steps.push([sOk + ' MPS server(s) removed' + (sFail ? ', ' + sFail + ' failed' : ''), sFail === 0]);

            if (!pols.length && !saps.length) steps.push(['No CIRA configuration was present', true]);
        } catch (e) {
            steps.push(['Unexpected error: ' + e.message, false]);
        }
        renderSteps('CIRA configuration removed',
            'All MPS servers and remote-access policies were removed. The device will stop dialing into the MPS.',
            'Some items could not be removed — review below.',
            steps, ['CIRA removed', 'Device will stop dialing in'], await readBack(amt));
    }

    // Build the WSMAN key selector set for a CIM instance from an enumerated item.
    function keySel(item, nameKey) {
        var s = {};
        [nameKey, 'CreationClassName', 'SystemCreationClassName', 'SystemName'].forEach(function (k) { if (item[k] != null) s[k] = item[k]; });
        return s;
    }

    async function configureCira(c, amt, cira) {
        var host = val('cira_host'), port = parseInt(val('cira_port'), 10) || 4433;
        var user = val('cira_user'), pass = document.getElementById('cira_pass').value;
        var trigger = parseInt(val('cira_trigger'), 10);
        var interval = parseInt(val('cira_interval'), 10) || 30;
        var domain = val('cira_domain');
        if (!host) return UI.toast('Missing address', 'Enter the MPS address the device should dial', 'bad');
        if (!user || !pass) return UI.toast('Missing credentials', 'Enter the MPS username and password', 'bad');
        if (!cira.cert) return UI.toast('No server certificate', 'The server did not provide its MPS certificate', 'bad');

        var infoFormat = /^(\d{1,3}\.){3}\d{1,3}$/.test(host) ? 3 : 201; // 3 = IPv4, 201 = FQDN
        clog('Configuring device → MPS', host + ':' + port, '| user', user, '| CN', cira.cn,
            '| trigger', trigger === 2 ? ('periodic/' + interval + 's') : 'user-initiated', '| InfoFormat', infoFormat, '| env-domain', domain || '(none)');

        var steps = [];
        UI.progress(true);
        try {
            // 1) Trust the MPS certificate (so the device can validate the TLS tunnel).
            var blob = pemToDerB64(cira.cert);
            var r1 = await Amt.exec(amt, 'AMT_PublicKeyManagementService', 'AddTrustedRootCertificate', { CertificateBlob: blob });
            clog('1/4 AddTrustedRootCertificate → status', r1.status, 'rv', r1.rv, '(' + (r1.rvStr || '-') + ')');
            if (r1.status === 200 && r1.rv === 0) steps.push(['Trusted root certificate added', true]);
            else if (r1.rv === 0x1601 /* ALREADY_EXISTS */ || r1.rv === 0x080A /* DUPLICATE */) steps.push(['Trusted root already present', true]);
            else steps.push(['Add trusted root: ' + (r1.rvStr || 'status ' + r1.status), false]);

            // 2) Add the MPS server (username/password auth).
            var r2 = await Amt.exec(amt, 'AMT_RemoteAccessService', 'AddMpServer', {
                AccessInfo: host, InfoFormat: infoFormat, Port: port, AuthMethod: 2,
                Username: user, Password: pass, CN: cira.cn || host
            });
            var mpServer = r2.body && r2.body.MpServer;
            clog('2/4 AddMpServer → status', r2.status, 'rv', r2.rv, '(' + (r2.rvStr || '-') + ') MpServer?', !!mpServer);
            if (r2.status === 200 && r2.rv === 0 && mpServer) { steps.push(['MPS server added', true]); }
            else { steps.push(['Add MPS server: ' + (r2.rvStr || 'status ' + r2.status), false]); return finish(c, amt, steps); }

            // 3) Add the remote-access policy that triggers the tunnel.
            // AMT validates method parameters in schema order, so build them in the exact
            // sequence Trigger, TunnelLifeTime, ExtendedData, MpServer — a wrong order is
            // rejected with an HTTP 400 SchemaValidationError.
            var policyArgs = { Trigger: trigger, TunnelLifeTime: 0 };
            if (trigger === 2) policyArgs.ExtendedData = btoa(intToStr(0) + intToStr(interval)); // 0 = periodic
            policyArgs.MpServer = eprToXml(mpServer);
            var r3 = await Amt.exec(amt, 'AMT_RemoteAccessService', 'AddRemoteAccessPolicyRule', policyArgs);
            clog('3/4 AddRemoteAccessPolicyRule → status', r3.status, 'rv', r3.rv, '(' + (r3.rvStr || '-') + ')');
            if (r3.status === 200 && r3.rv === 0) steps.push(['Remote access policy added', true]);
            else if (r3.rv === 0x080A /* DUPLICATE */) steps.push(['Remote access policy already present', true]);
            else steps.push(['Add policy: ' + (r3.rvStr || 'status ' + r3.status), false]);

            // 4) Environment detection — make the device consider itself "external".
            if (domain) {
                var eds = await Amt.get(amt, 'AMT_EnvironmentDetectionSettingData');
                if (eds.status === 200 && eds.body) {
                    var clone = Object.assign({}, eds.body, { DetectionStrings: [domain] });
                    var r4 = await Amt.put(amt, 'AMT_EnvironmentDetectionSettingData', clone);
                    clog('4/4 EnvironmentDetection set', domain, '→ status', r4.status);
                    steps.push([r4.status === 200 ? 'Environment detection set' : ('Environment detection: ' + Amt.wsErr(r4.resp, r4.status)), r4.status === 200]);
                } else steps.push(['Environment detection: could not read settings', false]);
            }
        } catch (e) {
            clog('ERROR', e.message);
            steps.push(['Unexpected error: ' + e.message, false]);
        }
        finish(c, amt, steps, await readBack(amt));
    }

    // Read back what CIRA config is actually on the device now, for verification. Returns
    // an HTML block for the summary modal (and logs the raw instances to the console).
    async function readBack(amt) {
        try {
            var saps = (await Amt.enum(amt, 'AMT_ManagementPresenceRemoteSAP')).items || [];
            var pols = (await Amt.enum(amt, 'AMT_RemoteAccessPolicyRule')).items || [];
            clog('On device now — MPS servers:', saps, '| policies:', pols);
            var sapList = saps.map(function (s) { return '· ' + Comp.esc((s.AccessInfo || s.Name || '?') + (s.Port ? ':' + s.Port : '')); }).join('<br>') || '<span class="muted">none</span>';
            var polList = pols.map(function (p) { return '· ' + Comp.esc(p.PolicyRuleName || 'policy'); }).join('<br>') || '<span class="muted">none</span>';
            return '<div style="margin-top:12px;padding-top:10px;border-top:1px solid rgba(128,128,128,.25)"><b>On the device now</b>' +
                '<div style="margin-top:6px;font-size:13px"><span class="muted">MPS servers (' + saps.length + '):</span><br>' + sapList + '</div>' +
                '<div style="margin-top:6px;font-size:13px"><span class="muted">Policies (' + pols.length + '):</span><br>' + polList + '</div>' +
                (saps.length > 1 ? '<div class="hint" style="margin-top:8px">⚠️ Multiple MPS servers — earlier runs left duplicates. Use “Remove CIRA configuration”, then configure once.</div>' : '') +
                '</div>';
        } catch (e) { return ''; }
    }

    function clog() { try { console.info.apply(console, ['%c[CIRA]', 'color:#4f8cff;font-weight:bold'].concat([].slice.call(arguments))); } catch (e) {} }

    function finish(c, amt, steps, extraHtml) {
        renderSteps('CIRA configured',
            'The device is set up to dial into the MPS. It should appear under Add device → Connect via CIRA shortly.',
            'Some steps did not complete — review below. Configuring CIRA usually requires Admin Control Mode (ACM).',
            steps, ['CIRA configured', 'Device will dial into the MPS'], extraHtml);
    }

    // Shared multi-step summary modal. steps: [ [label, ok], ... ]. okToast: [title, msg] or null.
    function renderSteps(title, okMsg, warnMsg, steps, okToast, extraHtml) {
        UI.progress(false);
        var ok = steps.every(function (s) { return s[1]; });
        var listHtml = steps.map(function (s) {
            return '<div style="display:flex;gap:8px;align-items:flex-start;margin:6px 0"><span>' + (s[1] ? '✅' : '⚠️') + '</span><span>' + Comp.esc(s[0]) + '</span></div>';
        }).join('');
        UI.modal({
            title: ok ? title : title + ' — with issues',
            okText: null, cancelText: 'Close',
            body: '<p class="muted" style="margin:0 0 10px">' + (ok ? okMsg : warnMsg) + '</p>' + listHtml + (extraHtml || '')
        });
        if (ok && okToast) UI.toast(okToast[0], okToast[1], 'good');
    }

    // PEM certificate -> base64 DER (strip the armor and whitespace).
    function pemToDerB64(pem) { return pem.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, ''); }
    // 32-bit big-endian integer as a binary string (matches the AMT engine's IntToStr).
    function intToStr(v) { return String.fromCharCode((v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF); }

    // Convert a parsed WSMAN EndpointReference (as returned by AddMpServer) back into the
    // raw reference XML that ExecMethod embeds for a reference-typed parameter.
    function eprToXml(epr) {
        if (!epr || !epr.ReferenceParameters) return null;
        var rp = epr.ReferenceParameters;
        var sels = rp.SelectorSet && rp.SelectorSet.Selector;
        if (!sels) return null;
        if (!Array.isArray(sels)) sels = [sels];
        var selXml = sels.map(function (s) {
            var name = (s && s['@Name']) ? s['@Name'] : 'Name';
            var value = (s && s.Value != null) ? s.Value : s;
            return '<Selector Name="' + name + '">' + value + '</Selector>';
        }).join('');
        var addr = epr.Address || 'http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous';
        return '<Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">' + addr + '</Address>' +
            '<ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">' +
            '<ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">' + rp.ResourceURI + '</ResourceURI>' +
            '<SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">' + selXml + '</SelectorSet>' +
            '</ReferenceParameters>';
    }

    function val(id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }

    // ---------------- existing feature toggles ----------------

    async function saveFeatures(c, amt, redir, hasKvm) {
        var wantSol = checked('set_sol'), wantIder = checked('set_ider'), wantListen = checked('set_listen');
        var wantKvm = document.getElementById('set_kvm') ? checked('set_kvm') : null;
        var newEs = 32768 + (wantIder ? 1 : 0) + (wantSol ? 2 : 0);

        UI.progress(true);
        var change = await Amt.call(amt, 'AMT_RedirectionService_RequestStateChange', newEs);
        if (change.status !== 200) { UI.progress(false); return UI.toast('Failed', 'RedirectionService ' + change.status, 'bad'); }
        if (hasKvm && wantKvm != null) await Amt.call(amt, 'CIM_KVMRedirectionSAP_RequestStateChange', wantKvm ? 2 : 3, 0);

        var clone = Object.assign({}, redir, { EnabledState: newEs, ListenerEnabled: wantListen });
        var put = await Amt.put(amt, 'AMT_RedirectionService', clone);
        UI.progress(false);
        if (put.status === 200) { UI.toast('Saved', 'Features updated', 'good'); Views.settings(c, amt); }
        else UI.toast('Failed', Amt.wsErr(put.resp, put.status), 'bad');
    }

    async function saveConsent(amt, optin) {
        if (!optin) { UI.toast('Not available', 'Opt-in service not present', 'warn'); return; }
        var clone = Object.assign({}, optin, { OptInRequired: parseInt(document.getElementById('set_optin').value) });
        UI.progress(true);
        var r = await Amt.put(amt, 'IPS_OptInService', clone);
        UI.progress(false);
        if (r.status === 200) UI.toast('Saved', 'Consent policy updated', 'good');
        else UI.toast('Failed', Amt.wsErr(r.resp, r.status), 'bad');
    }

    function checked(id) { return document.getElementById(id).checked; }
})();
