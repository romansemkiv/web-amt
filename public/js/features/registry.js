/**
 * Views — the tab registry. Each feature file assigns Views.<tabId> = render(container, amt, api).
 * App.setTab() looks up the renderer here. Shared helpers for the feature files live here too.
 */
var Views = {};

// Filename-safe base for exports, e.g. "eventlog-Lab_Workstation-20260704-1530".
Views.deviceBase = function () { return ((App.currentDevice() && App.currentDevice().name) || 'device').replace(/[^\w-]+/g, '_'); };
Views.exportName = function (kind) { return kind + '-' + Views.deviceBase() + '-' + UI.tstamp(); };
