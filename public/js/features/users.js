/* User Accounts — list, add, edit, delete, enable/disable (AMT_AuthorizationService). */
(function () {
    var PERMISSIONS = { 0: 'Local only', 1: 'Network only', 2: 'Local & network' };
    var ADMIN_HANDLE = -1;

    Views.users = function (c, amt) {
        Comp.loading(c, 'Reading user accounts…');
        load(c, amt);
    };

    async function load(c, amt) {
        var data = await fetchAccounts(amt);
        render(c, amt, data);
    }

    // Gather the digest realm, the admin entry and every user ACL entry (+ enabled state).
    async function fetchAccounts(amt) {
        var accounts = {};
        var gs = await Amt.get(amt, 'AMT_GeneralSettings');
        var realm = gs.body ? gs.body.DigestRealm : null;

        var admin = await Amt.call(amt, 'AMT_AuthorizationService_GetAdminAclEntry');
        var adminName = admin.body ? admin.body.Username : null;
        if (adminName) accounts[ADMIN_HANDLE] = { Handle: ADMIN_HANDLE, DigestUsername: adminName, AccessPermission: 999, Realms: null };

        var list = await Amt.call(amt, 'AMT_AuthorizationService_EnumerateUserAclEntries', 1);
        var handles = list.body && list.body.Handles ? (Array.isArray(list.body.Handles) ? list.body.Handles : [list.body.Handles]) : [];
        await Promise.all(handles.map(async function (h) {
            var entry = await Amt.call(amt, 'AMT_AuthorizationService_GetUserAclEntryEx', h);
            var enabled = await Amt.call(amt, 'AMT_AuthorizationService_GetAclEnabledState', h);
            var a = { Handle: h };
            if (entry.status === 200 && entry.body) {
                a = entry.body; a.Handle = h;
                a.Realms = !a.Realms ? [] : Array.isArray(a.Realms) ? a.Realms : [a.Realms];
            }
            if (enabled.status === 200 && enabled.body) a.__enabled = (enabled.body.State === true || enabled.body.State === 'true');
            accounts[h] = a;
        }));
        return { realm: realm, adminName: adminName, accounts: accounts };
    }

    function realmName(amt, i) { i = parseInt(i); return i === 3 ? 'Administrator' : (amt.RealmNames[i] || null); }

    function render(c, amt, data) {
        var reload = function () { Views.users(c, amt); };
        var rows = Object.keys(data.accounts).map(function (h) { return data.accounts[h]; });

        var table = Comp.table([
            { label: 'User', get: function (a) { return '<b>' + Comp.esc(a.DigestUsername || (a.Handle === ADMIN_HANDLE ? data.adminName : '(non-digest)')) + '</b>'; } },
            { label: 'Access', get: function (a) { return a.Handle === ADMIN_HANDLE ? 'Full admin' : (PERMISSIONS[a.AccessPermission] || '—'); } },
            { label: 'Realms', get: function (a) { return a.Handle === ADMIN_HANDLE ? 'All realms' : (Array.isArray(a.Realms) ? a.Realms.map(function (r) { return realmName(amt, r); }).filter(Boolean).join(', ') : '—'); } },
            { label: 'State', get: function (a) { return a.__enabled == null ? Comp.badge('Active', 'good') : Comp.boolBadge(a.__enabled); } },
            { label: 'Actions', get: function (a) {
                var edit = '<div class="btn sm" data-edit="' + a.Handle + '">Edit</div>';
                if (a.Handle === ADMIN_HANDLE) return edit;
                return edit + ' <div class="btn sm" data-toggle="' + a.Handle + '">' + (a.__enabled === false ? 'Enable' : 'Disable') + '</div> <div class="btn sm danger" data-del="' + a.Handle + '">Delete</div>';
            } }
        ], rows, { empty: 'No accounts found.' });

        c.innerHTML = Comp.heading('User Accounts',
            'Intel AMT accounts and their access realms. Digest realm: <span class="mono">' + Comp.esc(data.realm || '—') + '</span>',
            '<div class="btn primary sm" id="newAcct">' + Icons.svg('plus', 14) + ' New Account</div>') +
            Comp.card({ className: 'pad0', body: table });

        document.getElementById('newAcct').addEventListener('click', function () { accountDialog(amt, data.realm, null, reload); });
        wire(c, 'data-edit', function (a) { accountDialog(amt, data.realm, a, reload); }, data.accounts);
        wire(c, 'data-del', function (a) { deleteAccount(amt, a, reload); }, data.accounts);
        wire(c, 'data-toggle', function (a) { toggleAccount(amt, a, reload); }, data.accounts);
    }

    // Bind a click handler on every element carrying `attrName`, passing the matching account.
    function wire(c, attrName, handler, accounts) {
        c.querySelectorAll('[' + attrName + ']').forEach(function (n) {
            n.addEventListener('click', function () { handler(accounts[n.getAttribute(attrName)]); });
        });
    }

    function deleteAccount(amt, a, done) {
        UI.confirm('Delete account', 'Remove account "' + (a.DigestUsername || a.Handle) + '"?', 'Delete', 'danger').then(function (ok) {
            if (!ok) return;
            UI.progress(true);
            Amt.call(amt, 'AMT_AuthorizationService_RemoveUserAclEntry', parseInt(a.Handle)).then(function (r) {
                UI.progress(false);
                if (r.status === 200 && r.body && r.body.ReturnValue === 0) { UI.toast('Deleted', '', 'good'); done(); }
                else UI.toast('Delete failed', Amt.wsErr(r.resp, r.status), 'bad');
            });
        });
    }

    function toggleAccount(amt, a, done) {
        UI.progress(true);
        Amt.call(amt, 'AMT_AuthorizationService_SetAclEnabledState', parseInt(a.Handle), a.__enabled === false).then(function (r) {
            UI.progress(false);
            if (r.status === 200) { UI.toast('Updated', '', 'good'); done(); } else UI.toast('Failed', 'status ' + r.status, 'bad');
        });
    }

    // ---- Add / edit dialog ----
    function accountDialog(amt, realm, existing, done) {
        var isAdmin = existing && existing.Handle === ADMIN_HANDLE;
        var isEdit = !!existing;
        UI.modal({
            title: isEdit ? (isAdmin ? 'Edit Administrator' : 'Edit Account') : 'New Account', okText: 'Save', wide: !isAdmin,
            body: '<div class="field"><label>Username</label><input id="ac_user" value="' + Comp.esc(existing ? (existing.DigestUsername || '') : '') + '"></div>' +
                '<div class="field-row"><div class="field"><label>Password' + (isEdit ? ' (leave blank to keep)' : '') + '</label><input id="ac_p1" type="password"></div>' +
                '<div class="field"><label>Confirm password</label><input id="ac_p2" type="password"></div></div>' +
                (isAdmin ? '' : permissionField(existing) + realmChecks(amt, existing)),
            onOk: function (m) { return saveAccount(m, amt, realm, existing, isAdmin, isEdit, done); }
        });
    }

    function permissionField(existing) {
        function opt(v, label) { return '<option value="' + v + '"' + (existing && existing.AccessPermission == v ? ' selected' : '') + '>' + label + '</option>'; }
        return '<div class="field"><label>Access type</label><select id="ac_perm">' + opt(2, 'Local & network') + opt(1, 'Network only') + opt(0, 'Local only') + '</select></div>';
    }
    function realmChecks(amt, existing) {
        var cur = existing && existing.Realms ? existing.Realms.map(Number) : [];
        var check = function (idx, label, bold) { return '<label class="check"><input type="checkbox" data-realm="' + idx + '"' + (cur.indexOf(idx) >= 0 ? ' checked' : '') + '> ' + (bold ? '<b>' + label + '</b>' : Comp.esc(label)) + '</label>'; };
        var boxes = check(3, 'Administrator', true);
        for (var i = 0; i < amt.RealmNames.length; i++) { if (amt.RealmNames[i]) boxes += check(i, amt.RealmNames[i]); }
        return '<label class="field" style="margin-top:6px"><span style="font-size:12.5px;color:var(--text-dim)">Access realms</span></label>' +
            '<div style="max-height:190px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px 12px">' + boxes + '</div>';
    }

    function saveAccount(m, amt, realm, existing, isAdmin, isEdit, done) {
        var user = m.querySelector('#ac_user').value.trim();
        var p1 = m.querySelector('#ac_p1').value, p2 = m.querySelector('#ac_p2').value;
        if (!user) { UI.toast('Username required', '', 'warn'); return false; }
        if (p1 !== p2) { UI.toast('Passwords do not match', '', 'warn'); return false; }
        if (!isEdit && !p1) { UI.toast('Password required', '', 'warn'); return false; }
        if (!realm) { UI.toast('Digest realm unknown', 'Cannot compute password hash', 'bad'); return false; }
        // AMT stores base64( MD5(username:realm:password) ).
        var digest = p1 ? window.btoa(rstr_md5(user + ':' + realm + ':' + p1)) : null;

        var after = function (r) {
            UI.progress(false);
            if (r.status === 200 && (!r.body || r.body.ReturnValue === 0)) { UI.toast('Saved', 'Account updated', 'good'); done(); }
            else UI.toast('Save failed', Amt.wsErr(r.resp, r.status), 'bad');
        };

        UI.progress(true);
        if (isAdmin) { Amt.call(amt, 'AMT_AuthorizationService_SetAdminAclEntryEx', user, digest).then(after); return; }

        var perm = parseInt(m.querySelector('#ac_perm').value);
        var realms = [];
        m.querySelectorAll('[data-realm]').forEach(function (x) { if (x.checked) realms.push(parseInt(x.getAttribute('data-realm'))); });
        if (!realms.length) { UI.progress(false); UI.toast('Select at least one realm', '', 'warn'); return false; }

        if (isEdit) Amt.call(amt, 'AMT_AuthorizationService_UpdateUserAclEntryEx', parseInt(existing.Handle), user, digest, null, perm, realms).then(after);
        else Amt.call(amt, 'AMT_AuthorizationService_AddUserAclEntryEx', user, digest, null, perm, realms).then(after);
    }
})();
