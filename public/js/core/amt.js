/**
 * Amt — helpers on top of the vendored AmtStack.
 *
 *  - Response accessors for the map returned by BatchEnum (pick / pickArr / version).
 *  - Promise wrappers (get / enum / put / exec / batch) so multi-step flows read
 *    top-to-bottom with async/await instead of nested callbacks.
 *  - Human-readable error text.
 *
 * The underlying stack (with all its named AMT_/CIM_/IPS_ methods) is still
 * passed straight to views; these are additive conveniences.
 */
var Amt = (function () {

    // ----- Response accessors (operate on a BatchEnum result map) -----
    function pick(map, key) { try { return map[key] && map[key].response ? map[key].response : null; } catch (e) { return null; } }
    function pickArr(map, key) {
        try {
            var r = map[key]; if (!r || !r.responses) return [];
            return Array.isArray(r.responses) ? r.responses : [r.responses];
        } catch (e) { return []; }
    }
    // Intel AMT version string from a CIM_SoftwareIdentity enumeration.
    function version(map) {
        var arr = pickArr(map, 'CIM_SoftwareIdentity');
        for (var i = 0; i < arr.length; i++) { if (arr[i].InstanceID && arr[i].InstanceID.indexOf('AMT') === 0 && arr[i].VersionString) return arr[i].VersionString; }
        for (i = 0; i < arr.length; i++) { if (arr[i].VersionString) return arr[i].VersionString; }
        return null;
    }

    // ----- Error text -----
    function wsErr(resp, status) {
        if (resp && resp.Header && resp.Header.WsmanError) return resp.Header.WsmanError;
        if (resp && resp.Body && resp.Body.ReturnValueStr) return resp.Body.ReturnValueStr;
        return 'status ' + status;
    }
    function connError(status) {
        if (status === 401 || status === 408) return 'Authentication failed — check the username and password.';
        if (status === 601 || status === 602) return 'Received an unexpected response. The target may not be an Intel AMT device.';
        if (status === 997) return 'TLS realm mismatch.';
        if (status === 0 || status == null) return 'Could not reach the device. Check the host, port and that AMT is enabled.';
        return 'Connection failed (status ' + status + ').';
    }

    // ----- Promise wrappers -----
    function get(amt, name, pri) {
        return new Promise(function (resolve) {
            amt.Get(name, function (s, n, resp, st) { resolve({ status: st, resp: resp, body: resp ? resp.Body : null }); }, 0, pri == null ? 1 : pri);
        });
    }
    function enumerate(amt, name, pri) {
        return new Promise(function (resolve) {
            amt.Enum(name, function (s, n, items, st) { resolve({ status: st, items: items || [] }); }, 0, pri == null ? 1 : pri);
        });
    }
    function put(amt, name, obj, selectors, pri) {
        return new Promise(function (resolve) {
            amt.Put(name, obj, function (s, n, resp, st) { resolve({ status: st, resp: resp, body: resp ? resp.Body : null }); }, 0, pri == null ? 1 : pri, selectors);
        });
    }
    function exec(amt, name, method, args, selectors, pri) {
        return new Promise(function (resolve) {
            amt.Exec(name, method, args || {}, function (s, n, resp, st) {
                var body = resp ? resp.Body : null;
                resolve({ status: st, resp: resp, body: body, rv: body ? body.ReturnValue : null, rvStr: body ? body.ReturnValueStr : null });
            }, 0, pri == null ? 1 : pri, selectors);
        });
    }
    function batch(amt, names, pri) {
        return new Promise(function (resolve) {
            amt.BatchEnum('', names, function (s, batchName, map, st) { resolve({ status: st, map: map }); }, null, true, pri == null ? 1 : pri);
        });
    }
    // Promise for any named stack method whose callback is (stack, name, resp, status[, tag]).
    function call(amt, methodName /*, ...args */) {
        var args = Array.prototype.slice.call(arguments, 2);
        return new Promise(function (resolve) {
            amt[methodName].apply(amt, args.concat([function (s, n, resp, st) { resolve({ status: st, resp: resp, body: resp ? resp.Body : null }); }]));
        });
    }

    return {
        pick: pick, pickArr: pickArr, version: version, wsErr: wsErr, connError: connError,
        get: get, enum: enumerate, put: put, exec: exec, batch: batch, call: call
    };
})();
