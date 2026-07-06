/**
 * Icons — a self-contained inline-SVG icon set drawn in the Apple SF Symbols style
 * (monoline, 1.7px stroke, rounded caps/joins on a 24×24 grid, currentColor).
 *
 * SF Symbols itself is not a web font and its license is limited to Apple-platform
 * apps, so these are original SF-style glyphs that render identically on every OS.
 *
 * Usage: Icons.svg('gearshape')  ·  Icons.svg('power', 20)
 */
var Icons = (function () {
    var P = {
        // navigation / tabs
        gauge: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/>',
        cpu: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/>',
        list: '<path d="M8.5 6.5h11.5M8.5 12h11.5M8.5 17.5h11.5"/><circle cx="4.5" cy="6.5" r="1.1"/><circle cx="4.5" cy="12" r="1.1"/><circle cx="4.5" cy="17.5" r="1.1"/>',
        shield: '<path d="M12 3l7.5 3v5.2c0 4.9-3.4 8.1-7.5 9.8-4.1-1.7-7.5-4.9-7.5-9.8V6z"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.6 2.6 15.4 0 18M12 3c-2.6 2.6-2.6 15.4 0 18"/>',
        people: '<circle cx="12" cy="8.2" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>',
        terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.6"/><path d="M7.5 10l3 2.5-3 2.5M13 15h4"/>',
        display: '<rect x="3" y="4.5" width="18" height="11.5" rx="2.2"/><path d="M9 20h6M12 16v4"/>',
        disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.4"/>',
        gearshape: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
        code: '<path d="M8.5 8l-4 4 4 4M15.5 8l4 4-4 4M13.5 5l-3 14"/>',

        // power
        power: '<path d="M12 3v8.5"/><path d="M7.3 6.3a8 8 0 1 0 9.4 0"/>',
        arrowclockwise: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20.5 4v4.2h-4.2"/>',
        arrowcycle: '<path d="M4.5 10a7.6 7.6 0 0 1 12.6-3l2.4 2.4"/><path d="M19.5 14a7.6 7.6 0 0 1-12.6 3l-2.4-2.4"/><path d="M19.5 5.5v3.9h-3.9M4.5 18.5v-3.9h3.9"/>',
        floppy: '<rect x="4" y="4" width="16" height="16" rx="2.2"/><path d="M8 4v5h8V4M8 20v-6h8v6"/>',

        // sidebar / actions
        plus: '<path d="M12 5.5v13M5.5 12h13"/>',
        moon: '<path d="M20 14.4A8 8 0 1 1 9.6 4 6.6 6.6 0 0 0 20 14.4z"/>',
        download: '<path d="M12 3.5v11.5"/><path d="M7.5 11l4.5 4.5 4.5-4.5"/><path d="M4.5 20h15"/>',
        upload: '<path d="M12 20.5V9"/><path d="M7.5 13L12 8.5 16.5 13"/><path d="M4.5 4h15"/>',
        pencil: '<path d="M4 20h4l10-10a2.83 2.83 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',

        // KVM toolbar
        camera: '<rect x="3" y="7" width="18" height="13" rx="2.6"/><circle cx="12" cy="13.5" r="3.6"/><path d="M8.2 7l1.4-2.4h4.8L15.8 7"/>',
        record: '<circle cx="12" cy="12" r="5.5"/>',
        fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
        keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2.2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7.5 14h9"/>',
        rotate: '<path d="M15 4.5h5v5"/><path d="M20 4.5l-6.5 6.5"/><path d="M20 12a8 8 0 1 1-4.2-7"/>',

        // stat / kv accents
        chip: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/><rect x="9.75" y="9.75" width="4.5" height="4.5" rx="1"/><path d="M9 3.5v3M15 3.5v3M9 17.5v3M15 17.5v3M3.5 9h3M3.5 15h3M17.5 9h3M17.5 15h3"/>',
        lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
        tag: '<path d="M3.5 12.5l9-9H19a1.5 1.5 0 0 1 1.5 1.5v6.5l-9 9z"/><circle cx="15.5" cy="8.5" r="1.4"/>',
        clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'
    };

    function svg(name, size, opts) {
        opts = opts || {};
        var inner = P[name];
        if (!inner) return ''; // unknown name renders nothing rather than a broken glyph
        var filled = name === 'record' || opts.filled;
        var s = size || 18;
        return '<svg class="ic-svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="' + (filled ? 'currentColor' : 'none') +
            '" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + '</svg>';
    }

    return { svg: svg, has: function (n) { return !!P[n]; } };
})();
