/**
 * Comp — reusable HTML building blocks for WebAMT views.
 *
 * Everything returns a string of markup (the app renders via innerHTML) using the
 * shared class names in app.css, so views compose UI without repeating boilerplate.
 */
var Comp = (function () {
    var esc = UI.esc;

    function attr(name, value) { return value ? ' ' + name + '="' + value + '"' : ''; }

    // Full-height spinner / message state
    function loading(el, msg) { el.innerHTML = '<div class="center-state"><div class="spinner"></div><p class="muted">' + esc(msg || 'Loading…') + '</p></div>'; }
    function errState(title, msg) { return '<div class="center-state"><div class="big">⚠️</div><h2>' + esc(title) + '</h2><p>' + esc(msg) + '</p></div>'; }

    // Page heading, optionally with a right-aligned actions block
    function heading(title, sub, actionsHtml) {
        var head = actionsHtml
            ? '<div class="card-title-row"><h1 class="section-title" style="margin:0">' + esc(title) + '</h1>' + actionsHtml + '</div>'
            : '<h1 class="section-title">' + esc(title) + '</h1>';
        return head + (sub ? '<p class="section-sub">' + sub + '</p>' : '');
    }

    // A card. opts: { title, actions, body, className }
    function card(opts) {
        var inner = '';
        if (opts.title != null) {
            inner += opts.actions
                ? '<div class="card-title-row"><h3>' + esc(opts.title) + '</h3>' + opts.actions + '</div>'
                : '<h3>' + esc(opts.title) + '</h3>';
        }
        inner += (opts.body || '');
        return '<div class="card' + (opts.className ? ' ' + opts.className : '') + '">' + inner + '</div>';
    }

    // Key/value table. rows: [ [label, valueHtml, mono?], ... ] — falsy rows are skipped.
    function kv(rows) {
        return '<table class="kv">' + rows.filter(Boolean).map(function (r) {
            var v = (r[1] == null || r[1] === '') ? '<span class="muted">—</span>' : r[1];
            return '<tr><td class="k">' + esc(r[0]) + '</td><td class="v' + (r[2] ? ' mono' : '') + '">' + v + '</td></tr>';
        }).join('') + '</table>';
    }

    // Stat tile: big value under a small label. `icon` may be an SF-icon name or raw text.
    function stat(label, value, icon) {
        var ic = icon ? (Icons.has(icon) ? Icons.svg(icon, 15) + ' ' : icon + ' ') : '';
        return '<div class="stat"><div class="label">' + ic + esc(label) + '</div><div class="value">' + value + '</div></div>';
    }
    // Inline SF-style icon passthrough for views.
    function icon(name, size) { return Icons.svg(name, size); }

    function badge(text, kind) { return '<span class="badge ' + (kind || '') + ' dot">' + esc(text) + '</span>'; }
    function boolBadge(b) { return b ? '<span class="badge good dot">Yes</span>' : '<span class="badge dot">No</span>'; }

    /**
     * Data table. columns: [{ label, cls?, get:(row,i)=>html }]. rows: array of objects.
     * opts: { empty, bodyId, rowAttrs:(row,i)=>string }
     */
    function table(columns, rows, opts) {
        opts = opts || {};
        var head = columns.map(function (col) { return '<th>' + esc(col.label) + '</th>'; }).join('');
        var body;
        if (rows && rows.length) {
            body = rows.map(function (row, i) {
                var cells = columns.map(function (col) {
                    var v = col.get(row, i); if (v == null || v === '') v = '—';
                    return '<td' + attr('class', col.cls) + '>' + v + '</td>';
                }).join('');
                return '<tr' + (opts.rowAttrs ? ' ' + opts.rowAttrs(row, i) : '') + '>' + cells + '</tr>';
            }).join('');
        } else {
            body = '<tr><td colspan="' + columns.length + '" class="muted">' + esc(opts.empty || 'No data.') + '</td></tr>';
        }
        return '<div class="tbl-wrap"><table class="data"><thead><tr>' + head + '</tr></thead><tbody' + attr('id', opts.bodyId) + '>' + body + '</tbody></table></div>';
    }

    /**
     * Sortable data table rendered into `container`. Columns are as for table(), plus an
     * optional `sort:(row)=>comparable` — columns with it get clickable headers that sort
     * ascending/descending. opts: { empty, bodyId, rowAttrs, defaultCol, defaultDir, onRender }.
     * Returns { redraw } and calls opts.onRender() after every render (re-apply filters there).
     */
    function sortableTable(container, columns, rows, opts) {
        opts = opts || {};
        var state = { col: opts.defaultCol == null ? -1 : opts.defaultCol, dir: opts.defaultDir || 1 };

        function draw() {
            var data = rows.slice();
            if (state.col >= 0 && columns[state.col] && columns[state.col].sort) {
                var key = columns[state.col].sort;
                data.sort(function (a, b) { var va = key(a), vb = key(b); return va < vb ? -state.dir : va > vb ? state.dir : 0; });
            }
            var head = columns.map(function (col, i) {
                if (!col.sort) return '<th>' + esc(col.label) + '</th>';
                var ind = state.col === i ? '<span class="th-arrow">' + (state.dir === 1 ? '↑' : '↓') + '</span>' : '';
                return '<th class="th-sort" data-si="' + i + '">' + esc(col.label) + ind + '</th>';
            }).join('');
            var body = data.length ? data.map(function (row, i) {
                var cells = columns.map(function (col) { var v = col.get(row, i); if (v == null || v === '') v = '—'; return '<td' + attr('class', col.cls) + '>' + v + '</td>'; }).join('');
                return '<tr' + (opts.rowAttrs ? ' ' + opts.rowAttrs(row, i) : '') + '>' + cells + '</tr>';
            }).join('') : '<tr><td colspan="' + columns.length + '" class="muted">' + esc(opts.empty || 'No data.') + '</td></tr>';
            container.innerHTML = '<div class="tbl-wrap"><table class="data"><thead><tr>' + head + '</tr></thead><tbody' + attr('id', opts.bodyId) + '>' + body + '</tbody></table></div>';
            container.querySelectorAll('.th-sort').forEach(function (th) {
                th.addEventListener('click', function () {
                    var i = parseInt(th.getAttribute('data-si'));
                    if (state.col === i) state.dir = -state.dir; else { state.col = i; state.dir = 1; }
                    draw();
                });
            });
            if (opts.onRender) opts.onRender();
        }
        draw();
        return { redraw: draw };
    }

    // Standard filter text box.
    function filterInput(id) { return '<input id="' + id + '" class="filter-input" placeholder="Filter…">'; }

    // Labelled toggle row used in Settings.
    function toggle(id, label, on) {
        return '<label class="toggle-row"><span>' + esc(label) + '</span><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '></label>';
    }

    /**
     * Wire a live client-side row filter. opts:
     *   inputId, bodyId, countId (optional), match:(tr)=>bool (optional; default text contains)
     * Returns an apply() you can call to re-filter after re-render.
     */
    function wireFilter(opts) {
        var input = document.getElementById(opts.inputId);
        var extraEls = (opts.extraInputs || []).map(function (id) { return document.getElementById(id); });
        function apply() {
            var q = input ? input.value.toLowerCase() : '';
            var shown = 0;
            document.querySelectorAll('#' + opts.bodyId + ' tr').forEach(function (tr) {
                var ok = (!q || tr.textContent.toLowerCase().indexOf(q) >= 0) && (!opts.match || opts.match(tr));
                tr.style.display = ok ? '' : 'none'; if (ok) shown++;
            });
            if (opts.countId) { var cel = document.getElementById(opts.countId); if (cel) cel.textContent = shown; }
        }
        if (input) input.addEventListener('input', apply);
        extraEls.forEach(function (el) { if (el) el.addEventListener('change', apply); });
        return apply;
    }

    // Ask JSON vs CSV, then call pick(fmt).
    function exportMenu(onPick) {
        UI.modal({
            title: 'Export', okText: null, cancelText: 'Cancel',
            body: '<p class="muted" style="margin:0 0 14px">Choose a format:</p><div class="btn-row"><div class="btn primary" data-f="json">JSON</div><div class="btn" data-f="csv">CSV (spreadsheet)</div></div>',
            onShow: function (m) {
                m.querySelectorAll('[data-f]').forEach(function (n) {
                    n.addEventListener('click', function () { onPick(n.getAttribute('data-f')); var b = m.closest('.modal-back'); if (b) b.remove(); });
                });
            }
        });
    }

    return {
        esc: esc, loading: loading, errState: errState, heading: heading, card: card,
        kv: kv, stat: stat, icon: icon, badge: badge, boolBadge: boolBadge, table: table, sortableTable: sortableTable,
        filterInput: filterInput, toggle: toggle, wireFilter: wireFilter, exportMenu: exportMenu
    };
})();
