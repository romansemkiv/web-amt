/* WebAMT — small UI toolkit (toasts, modals, formatting) */
var UI = (function () {
    function esc(x) {
        if (x == null) return '';
        return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function toast(title, msg, kind, ms) {
        var host = document.getElementById('toasts');
        var t = document.createElement('div');
        t.className = 'toast ' + (kind || '');
        t.innerHTML = '<div class="t-title">' + esc(title) + '</div>' + (msg ? '<div class="t-msg">' + esc(msg) + '</div>' : '');
        host.appendChild(t);
        setTimeout(function () { t.style.transition = 'opacity .3s, transform .3s'; t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; setTimeout(function () { t.remove(); }, 300); }, ms || 3800);
    }

    // Modal. opts: {title, body(html), okText, onOk(modalEl)->bool|undefined, cancelText, wide, buttons:[{text,kind,onClick}]}
    function modal(opts) {
        var root = document.getElementById('modalRoot');
        var back = document.createElement('div');
        back.className = 'modal-back';
        var footButtons = '';
        if (opts.buttons) {
            footButtons = opts.buttons.map(function (b, i) { return '<div class="btn ' + (b.kind || '') + '" data-b="' + i + '">' + esc(b.text) + '</div>'; }).join('');
        } else {
            footButtons = '<div class="btn" data-role="cancel">' + esc(opts.cancelText || 'Cancel') + '</div>' +
                (opts.okText === null ? '' : '<div class="btn primary" data-role="ok">' + esc(opts.okText || 'OK') + '</div>');
        }
        back.innerHTML =
            '<div class="modal ' + (opts.wide ? 'wide' : '') + '">' +
            '<div class="modal-head"><h2>' + esc(opts.title || '') + '</h2><div class="x-close" data-role="cancel">×</div></div>' +
            '<div class="modal-body">' + (opts.body || '') + '</div>' +
            '<div class="modal-foot">' + footButtons + '</div></div>';
        root.appendChild(back);
        var modalEl = back.querySelector('.modal');
        function close() { back.remove(); }
        // Dismissing via the backdrop is a cancel too — callers relying on onCancel
        // (e.g. UI.confirm's promise) must always get an answer.
        back.addEventListener('click', function (e) { if (e.target === back) { if (opts.onCancel) opts.onCancel(); close(); } });
        back.querySelectorAll('[data-role=cancel]').forEach(function (n) { n.addEventListener('click', function () { if (opts.onCancel) opts.onCancel(); close(); }); });
        var okBtn = back.querySelector('[data-role=ok]');
        if (okBtn) okBtn.addEventListener('click', function () { var r = opts.onOk ? opts.onOk(modalEl) : true; if (r !== false) close(); });
        if (opts.buttons) {
            back.querySelectorAll('[data-b]').forEach(function (n) {
                n.addEventListener('click', function () { var b = opts.buttons[parseInt(n.getAttribute('data-b'))]; var r = b.onClick ? b.onClick(modalEl) : true; if (r !== false) close(); });
            });
        }
        if (opts.onShow) opts.onShow(modalEl);
        var f = modalEl.querySelector('input,select,textarea'); if (f) f.focus();
        return { el: modalEl, close: close };
    }

    function confirm(title, msg, okText, kind) {
        return new Promise(function (resolve) {
            modal({
                title: title, body: '<p class="muted" style="margin:0">' + esc(msg) + '</p>',
                onCancel: function () { resolve(false); }, // ✕ button or backdrop click
                buttons: [
                    { text: 'Cancel', onClick: function () { resolve(false); } },
                    { text: okText || 'Confirm', kind: kind || 'primary', onClick: function () { resolve(true); } }
                ]
            });
        });
    }

    function progress(on) {
        var p = document.getElementById('progline');
        if (p) p.className = 'progline' + (on ? ' active' : '');
    }

    function jsonHtml(obj) {
        var json = JSON.stringify(obj, function (k, v) { return typeof v === 'function' ? undefined : v; }, 2);
        if (json == null) return '';
        json = esc(json);
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            var cls = 'json-num';
            if (/^"/.test(match)) { cls = /:$/.test(match) ? 'json-key' : 'json-str'; }
            else if (/true|false/.test(match)) { cls = 'json-bool'; }
            else if (/null/.test(match)) { cls = 'json-bool'; }
            return '<span class="' + cls + '">' + match + '</span>';
        });
    }

    function spinner() { return '<div class="spinner"></div>'; }

    function saveBlob(filename, blob) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    }
    function download(filename, content, mime) { saveBlob(filename, new Blob([content], { type: mime || 'application/octet-stream' })); }
    // Save a binary string (each char = one byte), e.g. a KVM recording.
    function downloadBytes(filename, binaryString) {
        var bytes = new Uint8Array(binaryString.length);
        for (var i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i) & 0xff;
        saveBlob(filename, new Blob([bytes]));
    }
    // rows = array of objects; cols = [{key,label}]
    function toCsv(rows, cols) {
        function cell(v) { if (v == null) v = ''; v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
        var head = cols.map(function (c) { return cell(c.label); }).join(',');
        var body = rows.map(function (r) { return cols.map(function (c) { return cell(r[c.key]); }).join(','); }).join('\n');
        return head + '\n' + body;
    }
    function tstamp() { var d = new Date(); function p(n) { return ('0' + n).slice(-2); } return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }

    function fmtBytes(n) {
        if (n == null || isNaN(n)) return '—';
        if (n === 0) return '0 B';
        var u = ['B', 'KB', 'MB', 'GB', 'TB']; var i = Math.floor(Math.log(n) / Math.log(1024));
        return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
    }

    return { esc: esc, toast: toast, modal: modal, confirm: confirm, progress: progress, jsonHtml: jsonHtml, spinner: spinner, fmtBytes: fmtBytes, download: download, downloadBytes: downloadBytes, toCsv: toCsv, tstamp: tstamp };
})();
