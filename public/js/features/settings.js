/* Settings — enable/disable AMT features (SOL, IDER, KVM, listener) and user-consent policy. */
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
            '</div>';

        document.getElementById('saveFeatures').addEventListener('click', function () { saveFeatures(c, amt, redir, kvm != null); });
        document.getElementById('saveOptin').addEventListener('click', function () { saveConsent(amt, optin); });
    }

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
