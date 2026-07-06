/* Network — wired/wireless interfaces (view + edit IPv4), general settings, Wi-Fi profiles. */
(function () {
    var NET_CLASSES = ['AMT_EthernetPortSettings', '*AMT_GeneralSettings', 'CIM_WiFiEndpointSettings'];

    Views.network = function (c, amt) {
        Comp.loading(c, 'Reading network settings…');
        load(c, amt);
    };

    async function load(c, amt) {
        var map = (await Amt.batch(amt, NET_CLASSES)).map;
        var eth = Amt.pickArr(map, 'AMT_EthernetPortSettings');
        var gs = Amt.pick(map, 'AMT_GeneralSettings');
        var wifi = Amt.pickArr(map, 'CIM_WiFiEndpointSettings');

        var html = Comp.heading('Network', 'Intel AMT network interfaces and settings.');
        eth.forEach(function (e, i) {
            var wired = (e.InstanceID || '').indexOf('Wired') >= 0 || i === 0;
            html += '<div style="margin-bottom:16px">' + Comp.card({
                title: (wired ? '🔌 Wired Interface' : '📶 Wireless Interface'),
                actions: '<div class="btn sm" data-editeth="' + i + '">' + Icons.svg('pencil', 13) + ' Edit IPv4</div>',
                body: Comp.kv([
                    ['Interface', Comp.esc(e.InstanceID)],
                    ['MAC address', Comp.esc(e.MACAddress), true],
                    ['DHCP enabled', Comp.boolBadge(e.DHCPEnabled)],
                    ['IP address', Comp.esc(e.IPAddress), true],
                    ['Subnet mask', Comp.esc(e.SubnetMask), true],
                    ['Default gateway', Comp.esc(e.DefaultGateway), true],
                    ['Primary DNS', Comp.esc(e.PrimaryDNS), true],
                    ['Secondary DNS', Comp.esc(e.SecondaryDNS), true],
                    ['Link status', e.LinkIsUp != null ? Comp.boolBadge(e.LinkIsUp) : null]
                ])
            }) + '</div>';
        });
        html += Comp.card({ title: 'General', body: Comp.kv([
            ['Host name', gs ? Comp.esc(gs.HostName) : null],
            ['Domain name', gs ? Comp.esc(gs.DomainName) : null],
            ['Shared FQDN', gs ? Comp.boolBadge(gs.SharedFQDN) : null],
            ['Dynamic DNS update', gs ? Comp.boolBadge(gs.DDNSUpdateEnabled) : null]
        ]) });
        if (wifi.length) {
            html += '<div style="margin-top:16px">' + Comp.card({ title: 'Wi-Fi Profiles (' + wifi.length + ')', body: Comp.table([
                { label: 'SSID', get: function (w) { return Comp.esc(w.SSID); } },
                { label: 'Priority', get: function (w) { return Comp.esc(w.Priority); } },
                { label: 'Auth', get: function (w) { return Comp.esc(w.AuthenticationMethod); } },
                { label: 'Encryption', get: function (w) { return Comp.esc(w.EncryptionMethod); } }
            ], wifi) }) + '</div>';
        }
        c.innerHTML = html;

        c.querySelectorAll('[data-editeth]').forEach(function (n) {
            n.addEventListener('click', function () { editIpv4(amt, eth[parseInt(n.getAttribute('data-editeth'))], function () { Views.network(c, amt); }); });
        });
    }

    // Edit IPv4 settings (Put AMT_EthernetPortSettings with the interface as its own selector).
    function editIpv4(amt, e, done) {
        var dhcp = e.DHCPEnabled === true;
        UI.modal({
            title: 'IPv4 Settings', okText: 'Save',
            body: '<label class="check"><input type="radio" name="ipm" value="dhcp"' + (dhcp ? ' checked' : '') + '> Automatic (DHCP)</label>' +
                '<label class="check"><input type="radio" name="ipm" value="static"' + (!dhcp ? ' checked' : '') + '> Static IPv4 configuration</label>' +
                '<div id="ipStatic" style="margin-top:8px">' +
                    field2('IP address', 'ip_a', e.IPAddress, 'Subnet mask', 'ip_s', e.SubnetMask) +
                    '<div class="field"><label>Default gateway</label><input id="ip_g" value="' + Comp.esc(e.DefaultGateway || '') + '"></div>' +
                    field2('Primary DNS', 'ip_d1', e.PrimaryDNS, 'Secondary DNS', 'ip_d2', e.SecondaryDNS) +
                '</div>',
            onShow: function (m) {
                function upd() {
                    var isStatic = m.querySelector('input[value=static]').checked;
                    m.querySelector('#ipStatic').style.opacity = isStatic ? '1' : '.4';
                    m.querySelectorAll('#ipStatic input').forEach(function (x) { x.disabled = !isStatic; });
                }
                m.querySelectorAll('input[name=ipm]').forEach(function (r) { r.addEventListener('change', upd); });
                upd();
            },
            onOk: function (m) {
                var isDhcp = m.querySelector('input[value=dhcp]').checked;
                var x = Object.assign({}, e, { DHCPEnabled: isDhcp });
                ['IPAddress', 'SubnetMask', 'DefaultGateway', 'PrimaryDNS', 'SecondaryDNS'].forEach(function (k) { delete x[k]; });
                if (!isDhcp) {
                    x.IpSyncEnabled = false;
                    x.IPAddress = val(m, '#ip_a'); x.SubnetMask = val(m, '#ip_s'); x.DefaultGateway = val(m, '#ip_g');
                    if (val(m, '#ip_d1')) x.PrimaryDNS = val(m, '#ip_d1');
                    if (val(m, '#ip_d2')) x.SecondaryDNS = val(m, '#ip_d2');
                    if (!x.IPAddress || !x.SubnetMask) { UI.toast('Missing values', 'IP address and subnet mask are required', 'warn'); return false; }
                }
                UI.progress(true);
                Amt.put(amt, 'AMT_EthernetPortSettings', x, x).then(function (r) {
                    UI.progress(false);
                    if (r.status === 200) { UI.toast('Saved', 'Network settings updated. The device may briefly drop the connection.', 'good'); if (done) done(); }
                    else UI.toast('Save failed', Amt.wsErr(r.resp, r.status), 'bad');
                });
            }
        });
    }
    function field2(l1, id1, v1, l2, id2, v2) {
        return '<div class="field-row"><div class="field"><label>' + l1 + '</label><input id="' + id1 + '" value="' + Comp.esc(v1 || '') + '"></div>' +
            '<div class="field"><label>' + l2 + '</label><input id="' + id2 + '" value="' + Comp.esc(v2 || '') + '"></div></div>';
    }
    function val(m, sel) { return m.querySelector(sel).value.trim(); }
})();
