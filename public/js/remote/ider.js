/* Storage Redirection (IDER) — mount a floppy .img / CD-ROM .iso so the machine can boot from it. */
Remote.ider = function (c, amt, api) {
    var dev = api.device;
    render();

    function mounted() { return Remote.iderSess.redir && Remote.iderSess.redir.State === 3; }

    function render() {
        c.innerHTML = Comp.heading('Storage Redirection (IDER)',
            'Mount a CD-ROM (.iso) or floppy (.img) image over the network so this machine can boot from it.') +
            Comp.card({ body: mounted() ? statusView() : mountForm() });
        wire();
        if (mounted()) updateStats();
    }

    function mountForm() {
        return '<div class="field"><label>CD-ROM image (.iso)</label><input type="file" id="iderIso" accept=".iso"></div>' +
            '<div class="field"><label>Floppy image (.img)</label><input type="file" id="iderImg" accept=".img"></div>' +
            '<div class="field"><label>Session start</label><select id="iderStart"><option value="2">Immediate</option><option value="0">On next boot</option><option value="1">Graceful</option></select></div>' +
            '<div class="btn primary" id="iderMount">Mount image</div>' +
            '<p class="hint" style="margin-top:12px">The image stays mounted while you switch tabs. After mounting, use <b>Reset &amp; boot</b> below and open <b>Remote Desktop</b> to watch it boot.</p>';
    }

    function statusView() {
        var s = Remote.iderSess;
        return '<div class="card-title-row"><h3 style="margin:0">Mounted image</h3><span class="badge good dot">Connected</span></div>' +
            Comp.kv([
                ['CD-ROM', s.cdromName ? Comp.esc(s.cdromName) : null],
                ['Floppy', s.floppyName ? Comp.esc(s.floppyName) : null],
                ['Traffic', '<span id="iderStats" class="mono">…</span>']
            ]) +
            '<div class="btn-row" style="margin-top:14px">' +
                (s.cdromName ? '<div class="btn good" id="bootCd">' + Icons.svg('arrowclockwise', 14) + ' Reset &amp; boot from CD</div>' : '') +
                (s.floppyName ? '<div class="btn good" id="bootFd">' + Icons.svg('arrowclockwise', 14) + ' Reset &amp; boot from Floppy</div>' : '') +
                '<div class="btn danger" id="iderUnmount">Unmount</div></div>';
    }

    function mount() {
        var iso = fileOf('iderIso'), img = fileOf('iderImg');
        if (!iso && !img) { UI.toast('No image selected', 'Choose an .iso or .img file', 'warn'); return; }
        if (iso && (iso.size % 2048) !== 0) { UI.toast('Invalid .iso', 'Size must be a multiple of 2048 bytes', 'bad'); return; }
        if (img && (img.size % 512) !== 0) { UI.toast('Invalid .img', 'Size must be a multiple of 512 bytes', 'bad'); return; }

        Remote.stopIder();
        var o = CreateAmtRemoteIder();
        o.cdrom = iso || null;
        o.floppy = img || null;
        o.iderStart = parseInt(document.getElementById('iderStart').value); // 0=next boot, 1=graceful, 2=immediate
        var redir = CreateAmtRedirect(o);
        redir.onStateChanged = onState;
        Remote.iderSess = { obj: o, redir: redir, timer: null, cdromName: iso ? iso.name : null, floppyName: img ? img.name : null };
        Remote.startRedir(redir, o, amt, dev);
        UI.toast('Mounting…', '', 'good');
    }

    function onState(sender, st) {
        if (st === 3) {
            Remote.iderSess.timer = setInterval(updateStats, 1000);
            UI.toast('Storage mounted', 'The image is now available to the machine.', 'good');
            render();
        } else if (st === 0) {
            Remote.stopIder();
            render();
        }
    }

    function updateStats() {
        var s = Remote.iderSess, el = document.getElementById('iderStats');
        if (!s.obj || !el) return;
        if (s.obj.Update) s.obj.Update();
        el.textContent = fmt(s.obj.bytesFromAmt) + ' read · ' + fmt(s.obj.bytesToAmt) + ' sent';
    }

    function wire() {
        bind('iderMount', mount);
        bind('iderUnmount', function () { Remote.stopIder(); render(); UI.toast('Unmounted', '', 'good'); });
        bind('bootCd', function () { api.powerAction(202); }); // reset + boot IDER CD
        bind('bootFd', function () { api.powerAction(200); }); // reset + boot IDER floppy
    }

    function fileOf(id) { var el = document.getElementById(id); return el && el.files && el.files[0] ? el.files[0] : null; }
    function bind(id, fn) { var el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
    function fmt(n) { return UI.fmtBytes(n || 0); }
};
