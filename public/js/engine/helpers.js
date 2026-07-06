/**
 * Binary/string helper functions required by the AMT protocol engine.
 * Ported from MeshCommander (Apache-2.0, Intel Corporation / Ylian Saint-Hilaire).
 */

// Parsed URL query variables (the engine checks flags like ?wsmantrace / ?idertrace)
var urlvars = (function () {
    var v = {};
    try {
        var q = window.location.search.substring(1).split('&');
        for (var i = 0; i < q.length; i++) { var p = q[i].split('='); if (p[0]) v[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || ''); }
    } catch (e) { }
    return v;
})();

// Minimal DOM helpers used by the vendored terminal/KVM modules
function Q(x) { return (typeof x === 'string') ? document.getElementById(x) : x; }
function QS(x) { try { return Q(x).style; } catch (e) { } }

// Binary encoding / decoding on "binary strings" (one char = one byte)
function ReadShort(v, p) { return (v.charCodeAt(p) << 8) + v.charCodeAt(p + 1); }
function ReadShortX(v, p) { return (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); }
function ReadInt(v, p) { return (v.charCodeAt(p) * 0x1000000) + (v.charCodeAt(p + 1) << 16) + (v.charCodeAt(p + 2) << 8) + v.charCodeAt(p + 3); }
function ReadIntX(v, p) { return (v.charCodeAt(p + 3) * 0x1000000) + (v.charCodeAt(p + 2) << 16) + (v.charCodeAt(p + 1) << 8) + v.charCodeAt(p); }
function ShortToStr(v) { return String.fromCharCode((v >> 8) & 0xFF, v & 0xFF); }
function ShortToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF); }
function IntToStr(v) { return String.fromCharCode((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF); }
function IntToStrX(v) { return String.fromCharCode(v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF, (v >> 24) & 0xFF); }
function MakeToArray(v) { if (!v || v == null || typeof v == 'object') return v; return [v]; }

// Raw string <-> hex
function char2hex(i) { return (i + 0x100).toString(16).substr(-2).toUpperCase(); }
function rstr2hex(input) { var r = '', i; for (i = 0; i < input.length; i++) { r += char2hex(input.charCodeAt(i)); } return r; }

// UTF-8 decode for a binary string
function decode_utf8(s) { return decodeURIComponent(escape(s)); }

// "{0} and {1}" style formatting (used by the event-log decoders)
function format(format) { var args = Array.prototype.slice.call(arguments, 1); return format.replace(/{(\d+)}/g, function (match, number) { return typeof args[number] != 'undefined' ? args[number] : match; }); }
