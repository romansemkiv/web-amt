/* Event Log and Audit Log — decoded, filterable, exportable (JSON/CSV). */
(function () {
    function sevName(s) { return s >= 16 ? 'Critical' : s >= 8 ? 'Warning' : 'Normal'; }
    function sevKind(s) { return s >= 16 ? 'crit' : s >= 8 ? 'warn' : 'norm'; }
    function localTime(d) { return d ? Comp.esc(d.toLocaleString()) : ''; }
    function isoTime(d) { return d ? d.toISOString() : ''; }

    function exportRows(rows, cols, kind) {
        Comp.exportMenu(function (fmt) {
            if (fmt === 'csv') UI.download(Views.exportName(kind) + '.csv', UI.toCsv(rows, cols), 'text/csv');
            else UI.download(Views.exportName(kind) + '.json', JSON.stringify(rows, null, 2), 'application/json');
            UI.toast('Exported', rows.length + ' rows (' + fmt.toUpperCase() + ')', 'good');
        });
    }

    // ---------------- Event Log ----------------
    Views.events = function (c, amt) {
        Comp.loading(c, 'Reading event log…');
        amt.GetMessageLog(function (stack, messages) {
            if (!messages) { c.innerHTML = Comp.errState('Event log unavailable', 'The device did not return event records.'); return; }
            var columns = [
                { label: '#', get: function (m, i) { return i + 1; } },
                { label: 'Time', cls: 'mono', get: function (m) { return localTime(m.Time); }, sort: function (m) { return m.Time ? m.Time.getTime() : 0; } },
                { label: 'Sev', get: function (m) { return '<span class="badge ' + (m.EventSeverity >= 16 ? 'bad' : m.EventSeverity >= 8 ? 'warn' : 'good') + ' dot" style="padding:2px 6px" title="' + sevName(m.EventSeverity) + '"></span>'; }, sort: function (m) { return m.EventSeverity || 0; } },
                { label: 'Source', get: function (m) { return Comp.esc((m.EntityStr || '').replace('(r)', '®')); }, sort: function (m) { return (m.EntityStr || '').toLowerCase(); } },
                { label: 'Description', get: function (m) { return Comp.esc(m.Desc || ''); }, sort: function (m) { return (m.Desc || '').toLowerCase(); } }
            ];
            var actions = '<div class="btn-row">' + Comp.filterInput('evFilter') +
                '<select id="evSev" class="btn sm"><option value="">All severities</option><option value="crit">Critical</option><option value="warn">Warning</option><option value="norm">Normal</option></select>' +
                '<div class="btn sm" id="evExport">' + Icons.svg('download', 13) + ' Export</div><div class="btn sm" id="evRefresh">' + Icons.svg('arrowclockwise', 13) + ' Refresh</div><div class="btn sm danger" id="evClear">Clear Log</div></div>';
            c.innerHTML = Comp.heading('Event Log', '<span id="evCount">' + messages.length + '</span> of ' + messages.length + ' entries.', actions) +
                Comp.card({ className: 'pad0', body: '<div id="evTable"></div>' });

            var applyFilter = function () {};
            Comp.sortableTable(document.getElementById('evTable'), columns, messages, {
                bodyId: 'evBody',
                rowAttrs: function (m) { return 'data-sev="' + sevKind(m.EventSeverity) + '"'; },
                onRender: function () { applyFilter(); }
            });
            var sevSel = document.getElementById('evSev');
            applyFilter = Comp.wireFilter({ inputId: 'evFilter', bodyId: 'evBody', countId: 'evCount', extraInputs: ['evSev'],
                match: function (tr) { return !sevSel.value || tr.getAttribute('data-sev') === sevSel.value; } });
            applyFilter();
            document.getElementById('evRefresh').addEventListener('click', function () { Views.events(c, amt); });
            document.getElementById('evExport').addEventListener('click', function () {
                var rows = messages.map(function (m) { return { time: isoTime(m.Time), severity: sevName(m.EventSeverity), source: (m.EntityStr || '').replace('(r)', '(R)'), description: m.Desc || '' }; });
                exportRows(rows, [{ key: 'time', label: 'Time' }, { key: 'severity', label: 'Severity' }, { key: 'source', label: 'Source' }, { key: 'description', label: 'Description' }], 'eventlog');
            });
            document.getElementById('evClear').addEventListener('click', function () {
                UI.confirm('Clear Event Log', 'Permanently clear all event log entries?', 'Clear', 'danger').then(function (ok) {
                    if (!ok) return;
                    amt.AMT_MessageLog_ClearLog(function (s, n, r, st) { if (st === 200) { UI.toast('Event log cleared', '', 'good'); Views.events(c, amt); } else UI.toast('Clear failed', 'status ' + st, 'bad'); });
                });
            });
        });
    };

    // ---------------- Audit Log ----------------
    Views.audit = function (c, amt) {
        Comp.loading(c, 'Reading audit log…');
        amt.GetAuditLog(function (stack, records, status) {
            records = records || [];
            var columns = [
                { label: '#', get: function (m, i) { return i + 1; } },
                { label: 'Time', cls: 'mono', get: function (m) { return localTime(m.Time); }, sort: function (m) { return m.Time ? m.Time.getTime() : 0; } },
                { label: 'Application', get: function (m) { return Comp.esc(m.AuditApp || m.AuditAppID); }, sort: function (m) { return String(m.AuditApp || m.AuditAppID || '').toLowerCase(); } },
                { label: 'Event', get: function (m) { return Comp.esc(m.Event || m.EventID); }, sort: function (m) { return String(m.Event || m.EventID || '').toLowerCase(); } },
                { label: 'Initiator', get: function (m) { return Comp.esc(m.Initiator || ''); }, sort: function (m) { return (m.Initiator || '').toLowerCase(); } },
                { label: 'Details', get: function (m) { return Comp.esc(m.ExStr || ''); }, sort: function (m) { return (m.ExStr || '').toLowerCase(); } }
            ];
            var actions = '<div class="btn-row">' + Comp.filterInput('auFilter') + '<div class="btn sm" id="auExport">' + Icons.svg('download', 13) + ' Export</div><div class="btn sm" id="auRefresh">' + Icons.svg('arrowclockwise', 13) + ' Refresh</div></div>';
            c.innerHTML = Comp.heading('Audit Log', '<span id="auCount">' + records.length + '</span> of ' + records.length + ' security audit records.', actions) +
                Comp.card({ className: 'pad0', body: '<div id="auTable"></div>' });

            var applyFilter = function () {};
            Comp.sortableTable(document.getElementById('auTable'), columns, records, {
                bodyId: 'auBody', empty: 'No audit records available (audit log may be disabled or empty).',
                onRender: function () { applyFilter(); }
            });
            applyFilter = Comp.wireFilter({ inputId: 'auFilter', bodyId: 'auBody', countId: 'auCount' });
            applyFilter();
            document.getElementById('auRefresh').addEventListener('click', function () { Views.audit(c, amt); });
            document.getElementById('auExport').addEventListener('click', function () {
                var rows = records.map(function (m) { return { time: isoTime(m.Time), application: m.AuditApp || m.AuditAppID, event: m.Event || m.EventID, initiator: m.Initiator || '', details: m.ExStr || '' }; });
                exportRows(rows, [{ key: 'time', label: 'Time' }, { key: 'application', label: 'Application' }, { key: 'event', label: 'Event' }, { key: 'initiator', label: 'Initiator' }, { key: 'details', label: 'Details' }], 'auditlog');
            });
        });
    };
})();
