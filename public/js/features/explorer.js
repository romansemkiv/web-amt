/* WSMAN Explorer — enumerate or get any AMT/CIM/IPS class and inspect the raw response. */
(function () {
    var CLASSES = ('AMT_GeneralSettings,AMT_SetupAndConfigurationService,AMT_BootSettingData,AMT_BootCapabilities,' +
        'AMT_EthernetPortSettings,AMT_RedirectionService,AMT_EnvironmentDetectionSettingData,AMT_TimeSynchronizationService,' +
        'AMT_MessageLog,AMT_AuditLog,AMT_WebUIService,CIM_ComputerSystem,CIM_ComputerSystemPackage,CIM_ServiceAvailableToElement,' +
        'CIM_Chassis,CIM_Chip,CIM_Card,CIM_BIOSElement,CIM_Processor,CIM_PhysicalMemory,CIM_MediaAccessDevice,CIM_SoftwareIdentity,' +
        'CIM_PowerManagementService,CIM_BootConfigSetting,CIM_BootSourceSetting,CIM_Account,CIM_KVMRedirectionSAP,CIM_WiFiEndpointSettings,' +
        'IPS_OptInService,IPS_HostBasedSetupService,IPS_KVMRedirectionSettingData,IPS_ScreenConfigurationService').split(',');

    Views.explorer = function (c, amt) {
        c.innerHTML = '<div class="explorer">' +
            Comp.card({ title: 'WSMAN Classes', body: '<input id="clsFilter" class="filter-input" style="width:100%;margin-bottom:10px" placeholder="Filter classes…"><div class="classlist" id="clsList"></div>', className: '' }) +
            '<div class="card" style="overflow:hidden;display:flex;flex-direction:column">' +
                '<div class="card-title-row"><h3 id="clsTitle" style="margin:0">Select a class</h3>' +
                '<div class="btn-row"><div class="btn sm" id="clsEnum">Enumerate</div><div class="btn sm" id="clsGet">Get</div></div></div>' +
                '<div style="flex:1;overflow:auto"><pre class="json" id="clsOut" style="min-height:200px">Pick a class on the left, then Enumerate (list all instances) or Get (single instance).</pre></div>' +
            '</div></div>';

        var selected = null;
        var filter = document.getElementById('clsFilter');

        function renderList() {
            var q = filter.value.toLowerCase();
            var list = document.getElementById('clsList');
            list.innerHTML = CLASSES.filter(function (x) { return !q || x.toLowerCase().indexOf(q) >= 0; })
                .map(function (x) { return '<div class="ci' + (x === selected ? ' active' : '') + '" data-c="' + x + '">' + x + '</div>'; }).join('');
            list.querySelectorAll('.ci').forEach(function (n) {
                n.addEventListener('click', function () { selected = n.getAttribute('data-c'); document.getElementById('clsTitle').textContent = selected; renderList(); });
            });
        }
        renderList();
        filter.addEventListener('input', renderList);

        async function run(kind) {
            if (!selected) { UI.toast('Pick a class first', '', 'warn'); return; }
            var out = document.getElementById('clsOut');
            out.textContent = 'Querying ' + selected + '…';
            UI.progress(true);
            var res = kind === 'enum' ? await Amt.enum(amt, selected) : await Amt.get(amt, selected);
            UI.progress(false);
            if (res.status !== 200) { out.innerHTML = '<span class="json-num">Error ' + res.status + '</span>' + (res.resp && res.resp.Header && res.resp.Header.WsmanError ? '\n' + Comp.esc(res.resp.Header.WsmanError) : ''); return; }
            out.innerHTML = UI.jsonHtml(kind === 'enum' ? res.items : res.body);
        }
        document.getElementById('clsEnum').addEventListener('click', function () { run('enum'); });
        document.getElementById('clsGet').addEventListener('click', function () { run('get'); });
    };
})();
