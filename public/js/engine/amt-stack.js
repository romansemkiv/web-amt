/**
 * Intel(R) AMT high-level stack — Get / Put / Create / Delete / Enum / BatchEnum / Exec
 * plus the exact power, boot-config and user-consent workflows used by MeshCommander.
 * Built on WsmanStackCreateService. (Logic ported from MeshCommander, Apache-2.0.)
 */
function AmtStackCreateService(wsmanStack) {
    var obj = {};
    obj.wsman = wsmanStack;
    obj.pfx = ['http://intel.com/wbem/wscim/1/amt-schema/1/', 'http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/', 'http://intel.com/wbem/wscim/1/ips-schema/1/'];
    obj.PendingEnums = [];
    obj.PendingBatchOperations = 0;
    obj.ActiveEnumsCount = 0;
    obj.MaxActiveEnumsCount = 1;
    obj.onProcessChanged = null;
    var _MaxProcess = 0, _LastProcess = 0;

    obj.GetPendingActions = function () { return (obj.PendingEnums.length * 2) + obj.ActiveEnumsCount + obj.wsman.comm.PendingAjax.length + obj.wsman.comm.ActiveAjaxCount + obj.PendingBatchOperations; };

    function _up() {
        var x = obj.GetPendingActions();
        if (_MaxProcess < x) _MaxProcess = x;
        if (obj.onProcessChanged != null && _LastProcess != x) { _LastProcess = x; obj.onProcessChanged(x, _MaxProcess); }
        if (x == 0) _MaxProcess = 0;
    }

    obj.CompleteName = function (name) {
        if (name.indexOf('AMT_') == 0) return obj.pfx[0] + name;
        if (name.indexOf('CIM_') == 0) return obj.pfx[1] + name;
        if (name.indexOf('IPS_') == 0) return obj.pfx[2] + name;
        return name;
    };

    obj.CompleteExecResponse = function (resp) {
        if (resp && resp != null && resp.Body && (resp.Body['ReturnValue'] != undefined)) { resp.Body.ReturnValueStr = obj.AmtStatusToStr(resp.Body['ReturnValue']); }
        return resp;
    };

    obj.Get = function (name, callback, tag, pri) { obj.wsman.ExecGet(obj.CompleteName(name), function (ws, resuri, response, xstatus) { _up(); callback(obj, name, response, xstatus, tag); }, 0, pri); _up(); };
    obj.Put = function (name, putobj, callback, tag, pri, selectors) { obj.wsman.ExecPut(obj.CompleteName(name), putobj, function (ws, resuri, response, xstatus) { _up(); callback(obj, name, response, xstatus, tag); }, 0, pri, selectors); _up(); };
    obj.Create = function (name, putobj, callback, tag, pri) { obj.wsman.ExecCreate(obj.CompleteName(name), putobj, function (ws, resuri, response, xstatus) { _up(); callback(obj, name, response, xstatus, tag); }, 0, pri); _up(); };
    obj.Delete = function (name, putobj, callback, tag, pri) { obj.wsman.ExecDelete(obj.CompleteName(name), putobj, function (ws, resuri, response, xstatus) { _up(); callback(obj, name, response, xstatus, tag); }, 0, pri); _up(); };
    obj.Exec = function (name, method, args, callback, tag, pri, selectors) { obj.wsman.ExecMethod(obj.CompleteName(name), method, args, function (ws, resuri, response, xstatus) { _up(); callback(obj, name, obj.CompleteExecResponse(response), xstatus, tag); }, 0, pri, selectors); _up(); };

    obj.Enum = function (name, callback, tag, pri) {
        if (obj.ActiveEnumsCount < obj.MaxActiveEnumsCount) {
            obj.ActiveEnumsCount++;
            obj.wsman.ExecEnum(obj.CompleteName(name), function (ws, resuri, response, xstatus, tag0) { _up(); _EnumStartSink(name, response, callback, resuri, xstatus, tag0); }, tag, pri);
        } else { obj.PendingEnums.push([name, callback, tag, pri]); }
        _up();
    };

    function _EnumStartSink(name, response, callback, resuri, status, tag) {
        if (status != 200) { callback(obj, name, null, status, tag); _EnumDoNext(1); return; }
        if (response == null || response.Header['Method'] != 'EnumerateResponse' || !response.Body['EnumerationContext']) { callback(obj, name, null, 603, tag); _EnumDoNext(1); return; }
        var enumctx = response.Body['EnumerationContext'];
        obj.wsman.ExecPull(resuri, enumctx, function (ws, resuri, response, xstatus) { _EnumContinueSink(name, response, callback, resuri, [], xstatus, tag); });
    }

    function _EnumContinueSink(name, response, callback, resuri, items, status, tag) {
        if (status != 200) { callback(obj, name, null, status, tag); _EnumDoNext(1); return; }
        if (response == null || response.Header['Method'] != 'PullResponse') { callback(obj, name, null, 604, tag); _EnumDoNext(1); return; }
        for (var i in response.Body['Items']) {
            if (response.Body['Items'][i] instanceof Array) {
                for (var j in response.Body['Items'][i]) { if (typeof response.Body['Items'][i][j] != 'function') { items.push(response.Body['Items'][i][j]); } }
            } else { if (typeof response.Body['Items'][i] != 'function') { items.push(response.Body['Items'][i]); } }
        }
        if (response.Body['EnumerationContext']) {
            var enumctx = response.Body['EnumerationContext'];
            obj.wsman.ExecPull(resuri, enumctx, function (ws, resuri, response, xstatus) { _EnumContinueSink(name, response, callback, resuri, items, xstatus, tag); });
        } else { _EnumDoNext(1); callback(obj, name, items, status, tag); _up(); }
    }

    function _EnumDoNext(dec) {
        obj.ActiveEnumsCount -= dec;
        if ((obj.ActiveEnumsCount >= obj.MaxActiveEnumsCount) || (obj.PendingEnums.length == 0)) { _up(); return; }
        var x = obj.PendingEnums.shift();
        obj.Enum(x[0], x[1], x[2]);
        _EnumDoNext(0);
    }

    // Batch of ENUM/GET operations. Prefix a name with '*' to GET instead of ENUM.
    obj.BatchEnum = function (batchname, names, callback, tag, continueOnError, pri) {
        var results = { _pending: names.length };
        obj.PendingBatchOperations += names.length;
        for (var i in names) {
            var n = names[i], f = obj.Enum;
            if (n[0] == '*') { f = obj.Get; n = n.substring(1); }
            f(n, function (stack, name, responses, status, tag0) {
                obj.PendingBatchOperations--; _up();
                tag0[2][name] = { response: (responses == null ? null : responses.Body), responses: responses, status: status };
                if ((--tag0[2]._pending) == 0) { delete tag0[2]._pending; callback.call(obj, obj, batchname, tag0[2], status, tag); }
            }, [batchname, names, results, (f == obj.Get ? 'Get' : 'Enum')], pri);
        }
    };

    obj.CancelAllQueries = function (s) { obj.wsman.CancelAllQueries(s); };

    // ---- Power management ----
    var refComputerSystem = '<Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/addressing</Address><ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_ComputerSystem</ResourceURI><SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><Selector Name="CreationClassName">CIM_ComputerSystem</Selector><Selector Name="Name">ManagedSystem</Selector></SelectorSet></ReferenceParameters>';
    var refBootConfig = '<Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/addressing</Address><ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_BootConfigSetting</ResourceURI><SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><Selector Name="InstanceID">Intel(r) AMT: Boot Configuration 0</Selector></SelectorSet></ReferenceParameters>';

    obj.CIM_PowerManagementService_RequestPowerStateChange = function (PowerState, ManagedElement, Time, TimeoutPeriod, callback_func) { obj.Exec('CIM_PowerManagementService', 'RequestPowerStateChange', { 'PowerState': PowerState, 'ManagedElement': ManagedElement, 'Time': Time, 'TimeoutPeriod': TimeoutPeriod }, callback_func, 0, 1); };
    obj.CIM_BootConfigSetting_ChangeBootOrder = function (Source, callback_func) { obj.Exec('CIM_BootConfigSetting', 'ChangeBootOrder', { 'Source': Source }, callback_func); };
    obj.CIM_BootService_SetBootConfigRole = function (BootConfigSetting, Role, callback_func) { obj.Exec('CIM_BootService', 'SetBootConfigRole', { 'BootConfigSetting': BootConfigSetting, 'Role': Role }, callback_func, 0, 1); };

    obj.RequestPowerStateChange = function (PowerState, callback_func) { obj.CIM_PowerManagementService_RequestPowerStateChange(PowerState, refComputerSystem, null, null, callback_func); };
    obj.SetBootConfigRole = function (Role, callback_func) { obj.CIM_BootService_SetBootConfigRole(refBootConfig, Role, callback_func); };
    obj.BootSourceRef = function (bootSource) { return '<Address xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2004/08/addressing</Address><ReferenceParameters xmlns="http://schemas.xmlsoap.org/ws/2004/08/addressing"><ResourceURI xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd">http://schemas.dmtf.org/wbem/wscim/1/cim-schema/2/CIM_BootSourceSetting</ResourceURI><SelectorSet xmlns="http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd"><Selector Name="InstanceID">Intel(r) AMT: ' + bootSource + '</Selector></SelectorSet></ReferenceParameters>'; };

    // ---- Clock ----
    obj.AMT_TimeSynchronizationService_GetLowAccuracyTimeSynch = function (callback_func) { obj.Exec('AMT_TimeSynchronizationService', 'GetLowAccuracyTimeSynch', {}, callback_func); };

    obj.AmtStatusToStr = function (code) { return obj.AmtStatusCodes[code] ? obj.AmtStatusCodes[code] : 'UNKNOWN_ERROR (' + code + ')'; };
    obj.AmtStatusCodes = {
        0x0000: 'SUCCESS', 0x0001: 'INTERNAL_ERROR', 0x0002: 'NOT_READY', 0x0003: 'INVALID_PT_MODE',
        0x0004: 'INVALID_MESSAGE_LENGTH', 0x0010: 'NOT_PERMITTED', 0x0011: 'NOT_OWNER', 0x0012: 'BLOCK_LOCKED_BY_OTHER',
        0x0016: 'INVALID_MEMBER_COUNT', 0x0017: 'MAX_LIMIT_REACHED', 0x0018: 'INVALID_AUTH_TYPE', 0x001A: 'INVALID_DHCP_MODE',
        0x001B: 'INVALID_IP_ADDRESS', 0x001C: 'INVALID_DOMAIN_NAME', 0x001F: 'INVALID_PROVISIONING_STATE',
        0x0021: 'INVALID_TIME', 0x0022: 'INVALID_INDEX', 0x0023: 'INVALID_PARAMETER', 0x0024: 'INVALID_NETMASK',
        0x0025: 'FLASH_WRITE_LIMIT_EXCEEDED', 0x0026: 'INVALID_IMAGE_LENGTH', 0x0027: 'INVALID_IMAGE_SIGNATURE',
        0x0400: 'PT_STATUS_SUCCESS', 0x0401: 'PT_STATUS_INTERNAL_ERROR', 0x0402: 'PT_STATUS_NOT_READY',
        0x0403: 'PT_STATUS_INVALID_PT_MODE', 0x0404: 'PT_STATUS_MAX_LIMIT_REACHED', 0x0405: 'PT_STATUS_INVALID_AUTH_TYPE',
        0x0800: 'PT_STATUS_INVALID_HANDLE', 0x0801: 'PT_STATUS_INVALID_PASSWORD', 0x0802: 'PT_STATUS_INVALID_REALM',
        0x0803: 'PT_STATUS_INVALID_KERBEROS_SETTINGS', 0x1600: 'DOT_STATUS_INVALID_CREDENTIALS',
        0x1601: 'DOT_STATUS_ALREADY_EXISTS'
    };


    // ---- Account / authorization service (from MeshCommander, Apache-2.0) ----
    obj.AMT_AuthorizationService_AddUserAclEntryEx = function (DigestUsername, DigestPassword, KerberosUserSid, AccessPermission, Realms, callback_func) { obj.Exec('AMT_AuthorizationService', 'AddUserAclEntryEx', { 'DigestUsername': DigestUsername, 'DigestPassword': DigestPassword, 'KerberosUserSid': KerberosUserSid, 'AccessPermission': AccessPermission, 'Realms': Realms }, callback_func); }
    obj.AMT_AuthorizationService_EnumerateUserAclEntries = function (StartIndex, callback_func) { obj.Exec('AMT_AuthorizationService', 'EnumerateUserAclEntries', { 'StartIndex': StartIndex }, callback_func); }
    obj.AMT_AuthorizationService_GetUserAclEntryEx = function (Handle, callback_func, tag) { obj.Exec('AMT_AuthorizationService', 'GetUserAclEntryEx', { 'Handle': Handle }, callback_func, tag); }
    obj.AMT_AuthorizationService_UpdateUserAclEntryEx = function (Handle, DigestUsername, DigestPassword, KerberosUserSid, AccessPermission, Realms, callback_func) { obj.Exec('AMT_AuthorizationService', 'UpdateUserAclEntryEx', { 'Handle': Handle, 'DigestUsername': DigestUsername, 'DigestPassword': DigestPassword, 'KerberosUserSid': KerberosUserSid, 'AccessPermission': AccessPermission, 'Realms': Realms }, callback_func); }
    obj.AMT_AuthorizationService_RemoveUserAclEntry = function (Handle, callback_func) { obj.Exec('AMT_AuthorizationService', 'RemoveUserAclEntry', { 'Handle': Handle }, callback_func); }
    obj.AMT_AuthorizationService_SetAdminAclEntryEx = function (Username, DigestPassword, callback_func) { obj.Exec('AMT_AuthorizationService', 'SetAdminAclEntryEx', { 'Username': Username, 'DigestPassword': DigestPassword }, callback_func); }
    obj.AMT_AuthorizationService_GetAdminAclEntry = function (callback_func) { obj.Exec('AMT_AuthorizationService', 'GetAdminAclEntry', {}, callback_func); }
    obj.AMT_AuthorizationService_SetAclEnabledState = function (Handle, Enabled, callback_func, tag) { obj.Exec('AMT_AuthorizationService', 'SetAclEnabledState', { 'Handle': Handle, 'Enabled': Enabled }, callback_func, tag); }
    obj.AMT_AuthorizationService_GetAclEnabledState = function (Handle, callback_func, tag) { obj.Exec('AMT_AuthorizationService', 'GetAclEnabledState', { 'Handle': Handle }, callback_func, tag); }

    // ---- Redirection / KVM feature enable (from MeshCommander, Apache-2.0) ----
    obj.AMT_RedirectionService_RequestStateChange = function (RequestedState, callback_func) { obj.Exec('AMT_RedirectionService', 'RequestStateChange', { 'RequestedState': RequestedState }, callback_func); }
    obj.CIM_KVMRedirectionSAP_RequestStateChange = function (RequestedState, TimeoutPeriod, callback_func) { obj.Exec('CIM_KVMRedirectionSAP', 'RequestStateChange', { 'RequestedState': RequestedState }, callback_func); }

    // ---- Event log & audit log method wrappers (from MeshCommander, Apache-2.0) ----
    obj.AMT_AuditLog_ReadRecords = function (StartIndex, callback_func, tag) { obj.Exec('AMT_AuditLog', 'ReadRecords', { 'StartIndex': StartIndex }, callback_func, tag); }
    obj.AMT_MessageLog_ClearLog = function (callback_func) { obj.Exec('AMT_MessageLog', 'ClearLog', { }, callback_func); }
    obj.AMT_MessageLog_GetRecords = function (IterationIdentifier, MaxReadRecords, callback_func, tag) { obj.Exec('AMT_MessageLog', 'GetRecords', { 'IterationIdentifier': IterationIdentifier, 'MaxReadRecords': MaxReadRecords }, callback_func, tag); }
    obj.AMT_MessageLog_PositionToFirstRecord = function (callback_func, tag) { obj.Exec('AMT_MessageLog', 'PositionToFirstRecord', {}, callback_func, tag); }

    // ---- Event log & audit log decoders (from MeshCommander, Apache-2.0) ----
    //

    obj.GetMessageLog = function (func, tag) {
        obj.AMT_MessageLog_PositionToFirstRecord(_GetMessageLog0, [func, tag, []]);
    }
    function _GetMessageLog0(stack, name, responses, status, tag) {
        if (status != 200 || responses.Body['ReturnValue'] != '0') { tag[0](obj, null, tag[2]); return; }
        obj.AMT_MessageLog_GetRecords(responses.Body['IterationIdentifier'], 390, _GetMessageLog1, tag);
    }
    function _GetMessageLog1(stack, name, responses, status, tag) {
        if (status != 200 || responses.Body['ReturnValue'] != '0') { tag[0](obj, null, tag[2]); return; }
        var i, j, x, e, AmtMessages = tag[2], t = new Date(), TimeStamp, ra = responses.Body['RecordArray'];
        if (typeof ra === 'string') { responses.Body['RecordArray'] = [responses.Body['RecordArray']]; }

        for (i in ra) {
            e = null;
            try { e = window.atob(ra[i]); } catch (ex) { }
            if (e != null) {
                TimeStamp = ReadIntX(e, 0);
                if ((TimeStamp > 0) && (TimeStamp < 0xFFFFFFFF)) {
                    x = { 'DeviceAddress': e.charCodeAt(4), 'EventSensorType': e.charCodeAt(5), 'EventType': e.charCodeAt(6), 'EventOffset': e.charCodeAt(7), 'EventSourceType': e.charCodeAt(8), 'EventSeverity': e.charCodeAt(9), 'SensorNumber': e.charCodeAt(10), 'Entity': e.charCodeAt(11), 'EntityInstance': e.charCodeAt(12), 'EventData': [], 'Time': new Date((TimeStamp + (t.getTimezoneOffset() * 60)) * 1000) };
                    for (j = 13; j < 21; j++) { x['EventData'].push(e.charCodeAt(j)); }
                    x['EntityStr'] = _SystemEntityTypes[x['Entity']];
                    x['Desc'] = _GetEventDetailStr(x['EventSensorType'], x['EventOffset'], x['EventData'], x['Entity']);
                    if (!x['EntityStr']) x['EntityStr'] = 'Unknown';
                    AmtMessages.push(x);
                }
            }
        }

        if (responses.Body['NoMoreRecords'] != true) { obj.AMT_MessageLog_GetRecords(responses.Body['IterationIdentifier'], 390, _GetMessageLog1, [tag[0], AmtMessages, tag[2]]); } else { tag[0](obj, AmtMessages, tag[2]); }
    }

    var _EventTrapSourceTypes = "Platform firmware (e.g. BIOS)|SMI handler|ISV system management software|Alert ASIC|IPMI|BIOS vendor|System board set vendor|System integrator|Third party add-in|OSV|NIC|System management card".split('|');
    var _SystemFirmwareError = "Unspecified.|No system memory is physically installed in the system.|No usable system memory, all installed memory has experienced an unrecoverable failure.|Unrecoverable hard-disk/ATAPI/IDE device failure.|Unrecoverable system-board failure.|Unrecoverable diskette subsystem failure.|Unrecoverable hard-disk controller failure.|Unrecoverable PS/2 or USB keyboard failure.|Removable boot media not found.|Unrecoverable video controller failure.|No video device detected.|Firmware (BIOS) ROM corruption detected.|CPU voltage mismatch (processors that share same supply have mismatched voltage requirements)|CPU speed matching failure".split('|');
    var _SystemFirmwareProgress = "Unspecified.|Memory initialization.|Starting hard-disk initialization and test|Secondary processor(s) initialization|User authentication|Entering BIOS setup|USB resource configuration|PCI resource configuration|Option ROM initialization|Video initialization|Cache initialization|SM Bus initialization|Keyboard controller initialization|Embedded controller/management controller initialization|Docking station attachment|Enabling docking station|Docking station ejection|Disabling docking station|Calling operating system wake-up vector|Starting operating system boot process|Baseboard or motherboard initialization|reserved|Floppy initialization|Keyboard test|Pointing device test|Primary processor initialization".split('|');
    var _SystemEntityTypes = "Unspecified|Other|Unknown|Processor|Disk|Peripheral|System management module|System board|Memory module|Processor module|Power supply|Add in card|Front panel board|Back panel board|Power system board|Drive backplane|System internal expansion board|Other system board|Processor board|Power unit|Power module|Power management board|Chassis back panel board|System chassis|Sub chassis|Other chassis board|Disk drive bay|Peripheral bay|Device bay|Fan cooling|Cooling unit|Cable interconnect|Memory device|System management software|BIOS|Intel(r) ME|System bus|Group|Intel(r) ME|External environment|Battery|Processing blade|Connectivity switch|Processor/memory module|I/O module|Processor I/O module|Management controller firmware|IPMI channel|PCI bus|PCI express bus|SCSI bus|SATA/SAS bus|Processor front side bus".split('|');
    obj.RealmNames = "||Redirection||Hardware Asset|Remote Control|Storage|Event Manager|Storage Admin|Agent Presence Local|Agent Presence Remote|Circuit Breaker|Network Time|General Information|Firmware Update|EIT|LocalUN|Endpoint Access Control|Endpoint Access Control Admin|Event Log Reader|Audit Log|ACL Realm|||Local System".split('|');
    obj.WatchdogCurrentStates = { 1: "Not Started", 2: "Stopped", 4: "Running", 8: "Expired", 16: "Suspended" };
    var _OCRProgressEvents = ["Boot parameters received from CSME", "CSME Boot Option % added successfully", "HTTPS URI name resolved", "HTTPS connected successfully", "HTTPSBoot download is completed", "Attempt to boot", "Exit boot services"];
    var _OCRErrorEvents = ['', "No network connection available", "Name resolution of URI failed", "Connect to URI failed", "OEM app not found at local URI", "HTTPS TLS Auth failed", "HTTPS Digest Auth failed", "Verified boot failed (bad image)", "HTTPS Boot File not found"];
    var _OCRSource = { 1: '', 2: "HTTPS", 4: "Local PBA", 8: "WinRE" };

    function _GetEventDetailStr(eventSensorType, eventOffset, eventDataField, entity) {
        if (eventSensorType == 15) {
            if (eventDataField[0] == 235) return "Invalid Data";
            if (eventOffset == 0) {
                return _SystemFirmwareError[eventDataField[1]];
            } else if (eventOffset == 3) {
                if ((eventDataField[0] == 170) && (eventDataField[1] == 48)) {
                    return format("AMT One Click Recovery: {0}", _OCRErrorEvents[eventDataField[2]]);
                } else if ((eventDataField[0] == 170) && (eventDataField[1] == 64)) {
                    if (eventDataField[2] == 1) return "Got an error erasing Device SSD";
                    if (eventDataField[2] == 2) return "Erasing Device TPM is not supported";
                    if (eventDataField[2] == 3) return "Reached Max Counter";
                } else {
                    return "OEM Specific Firmware Error event";
                }
            } else if (eventOffset == 5) {
                if ((eventDataField[0] == 170) && (eventDataField[1] == 48)) {
                    if (eventDataField[2] == 1) {
                        return format("AMT One Click Recovery: CSME Boot Option {0}:{1} added successfully", (eventDataField[3]), _OCRSource[(eventDataField[3])]);
                    } else if (eventDataField[2] < 7) {
                        return format("AMT One Click Recovery: {0}", _OCRProgressEvents[eventDataField[2]]);
                    } else {
                        return format("AMT One Click Recovery: Unknown progress event {0}", eventDataField[2]);
                    }
                } else if ((eventDataField[0] == 170) && (eventDataField[1] == 64)) {
                    if (eventDataField[2] == 1) {
                        if (eventDataField[3] == 2) return "Started erasing Device SSD";
                        if (eventDataField[3] == 3) return "Started erasing Device TPM";
                        if (eventDataField[3] == 5) return "Started erasing Device BIOS Reload of Golden Config";
                    }
                    if (eventDataField[2] == 2) {
                        if (eventDataField[3] == 2) return "Erasing Device SSD ended successfully";
                        if (eventDataField[3] == 3) return "Erasing Device TPM ended successfully";
                        if (eventDataField[3] == 5) return "Erasing Device BIOS Reload of Golden Config ended successfully";
                    }
                    if (eventDataField[2] == 3) return "Beginning Platform Erase";
                    if (eventDataField[2] == 4) return "Clear Reserved Parameters";
                    if (eventDataField[2] == 5) return "All setting decremented";
                } else {
                    return "OEM Specific Firmware Progress event";
                }
            } else {
                return _SystemFirmwareProgress[eventDataField[1]];
            }
        }

        if ((eventSensorType == 18) && (eventDataField[0] == 170)) { // System watchdog event
            return "Agent watchdog " + char2hex(eventDataField[4]) + char2hex(eventDataField[3]) + char2hex(eventDataField[2]) + char2hex(eventDataField[1]) + '-' + char2hex(eventDataField[6]) + char2hex(eventDataField[5]) + '-...' + " changed to " + obj.WatchdogCurrentStates[eventDataField[7]];
        }

        if ((eventSensorType == 5) && (eventOffset == 0)) { // System chassis
            return "Case intrusion";
        }

        if ((eventSensorType == 192) && (eventOffset == 0) && (eventDataField[0] == 170) && (eventDataField[1] == 48))
        {
            if (eventDataField[2] == 0) return "A remote Serial Over LAN session was established.";
            if (eventDataField[2] == 1) return "Remote Serial Over LAN session finished. User control was restored.";
            if (eventDataField[2] == 2) return "A remote IDE-Redirection session was established.";
            if (eventDataField[2] == 3) return "Remote IDE-Redirection session finished. User control was restored.";
        }

        if (eventSensorType == 36) {
            var handle = (eventDataField[1] << 24) + (eventDataField[2] << 16) + (eventDataField[3] << 8) + eventDataField[4];
            var nic = '#' + eventDataField[0];
            if (eventDataField[0] == 0xAA) nic = "wired"; // TODO: Add wireless *****
            //if (eventDataField[0] == 0xAA) nic = "wireless";

            if (handle == 4294967293) { return "All received packet filter was matched on " + nic + " interface."; }
            if (handle == 4294967292) { return "All outbound packet filter was matched on " + nic + " interface."; }
            if (handle == 4294967290) { return "Spoofed packet filter was matched on " + nic + " interface."; }
            return "Filter " + handle + " was matched on " + nic + " interface.";
        }

        if (eventSensorType == 192) {
            if (eventDataField[2] == 0) return "Security policy invoked. Some or all network traffic (TX) was stopped.";
            if (eventDataField[2] == 2) return "Security policy invoked. Some or all network traffic (RX) was stopped.";
            return "Security policy invoked.";
        }

        if (eventSensorType == 193) {
            if ((eventDataField[0] == 0xAA) && (eventDataField[1] == 0x30) && (eventDataField[2] == 0x00) && (eventDataField[3] == 0x00)) { return "User request for remote connection."; }
            if ((eventDataField[0] == 0xAA) && (eventDataField[1] == 0x20) && (eventDataField[2] == 0x03) && (eventDataField[3] == 0x01)) { return "EAC error: attempt to get posture while NAC in Intel� AMT is disabled."; } // eventDataField = 0xAA20030100000000
            if ((eventDataField[0] == 0xAA) && (eventDataField[1] == 0x20) && (eventDataField[2] == 0x04) && (eventDataField[3] == 0x00)) { return "HWA Error: general error"; } // Used to be "Certificate revoked." but don"t know the source of this.
        }

        if (eventSensorType == 6) return "Authentication failed " + (eventDataField[1] + (eventDataField[2] << 8)) + " times. The system may be under attack.";
        if (eventSensorType == 30) return "No bootable media";
        if (eventSensorType == 32) return "Operating system lockup or power interrupt";
        if (eventSensorType == 35) {
            if (eventDataField[0] == 64) return "BIOS POST (Power On Self-Test) Watchdog Timeout."; // 64,2,252,84,89,0,0,0
            return "System boot failure";
        }
        if (eventSensorType == 37) return "System firmware started (at least one CPU is properly executing).";
        return "Unknown Sensor Type #" + eventSensorType;
    }



    // Useful link: https://software.intel.com/sites/manageability/AMT_Implementation_and_Reference_Guide/default.htm?turl=WordDocuments%2Fsecurityadminevents.htm

    var _AmtAuditStringTable =
    {
        16: "Security Admin",
        17: "RCO",
        18: "Redirection Manager",
        19: "Firmware Update Manager",
        20: "Security Audit Log",
        21: "Network Time",
        22: "Network Administration",
        23: "Storage Administration",
        24: "Event Manager",
        25: "Circuit Breaker Manager",
        26: "Agent Presence Manager",
        27: "Wireless Configuration",
        28: "EAC",
        29: "KVM",
        30: "User Opt-In Events",
        32: "Screen Blanking",
        33: "Watchdog Events",
        1600: "Provisioning Started",
        1601: "Provisioning Completed",
        1602: "ACL Entry Added",
        1603: "ACL Entry Modified",
        1604: "ACL Entry Removed",
        1605: "ACL Access with Invalid Credentials",
        1606: "ACL Entry State",
        1607: "TLS State Changed",
        1608: "TLS Server Certificate Set",
        1609: "TLS Server Certificate Remove",
        1610: "TLS Trusted Root Certificate Added",
        1611: "TLS Trusted Root Certificate Removed",
        1612: "TLS Preshared Key Set",
        1613: "Kerberos Settings Modified",
        1614: "Kerberos Main Key Modified",
        1615: "Flash Wear out Counters Reset",
        1616: "Power Package Modified",
        1617: "Set Realm Authentication Mode",
        1618: "Upgrade Client to Admin Control Mode",
        1619: "Unprovisioning Started",
        1700: "Performed Power Up",
        1701: "Performed Power Down",
        1702: "Performed Power Cycle",
        1703: "Performed Reset",
        1704: "Set Boot Options",
        1705: "Remote graceful power down initiated",
        1706: "Remote graceful reset initiated",
        1707: "Remote Standby initiated",
        1708: "Remote Hiberate initiated",
        1709: "Remote NMI initiated",
        1800: "IDER Session Opened",
        1801: "IDER Session Closed",
        1802: "IDER Enabled",
        1803: "IDER Disabled",
        1804: "SoL Session Opened",
        1805: "SoL Session Closed",
        1806: "SoL Enabled",
        1807: "SoL Disabled",
        1808: "KVM Session Started",
        1809: "KVM Session Ended",
        1810: "KVM Enabled",
        1811: "KVM Disabled",
        1812: "VNC Password Failed 3 Times",
        1900: "Firmware Updated",
        1901: "Firmware Update Failed",
        2000: "Security Audit Log Cleared",
        2001: "Security Audit Policy Modified",
        2002: "Security Audit Log Disabled",
        2003: "Security Audit Log Enabled",
        2004: "Security Audit Log Exported",
        2005: "Security Audit Log Recovered",
        2100: "Intel&reg; ME Time Set",
        2200: "TCPIP Parameters Set",
        2201: "Host Name Set",
        2202: "Domain Name Set",
        2203: "VLAN Parameters Set",
        2204: "Link Policy Set",
        2205: "IPv6 Parameters Set",
        2300: "Global Storage Attributes Set",
        2301: "Storage EACL Modified",
        2302: "Storage FPACL Modified",
        2303: "Storage Write Operation",
        2400: "Alert Subscribed",
        2401: "Alert Unsubscribed",
        2402: "Event Log Cleared",
        2403: "Event Log Frozen",
        2500: "CB Filter Added",
        2501: "CB Filter Removed",
        2502: "CB Policy Added",
        2503: "CB Policy Removed",
        2504: "CB Default Policy Set",
        2505: "CB Heuristics Option Set",
        2506: "CB Heuristics State Cleared",
        2600: "Agent Watchdog Added",
        2601: "Agent Watchdog Removed",
        2602: "Agent Watchdog Action Set",
        2700: "Wireless Profile Added",
        2701: "Wireless Profile Removed",
        2702: "Wireless Profile Updated",
        2703: "An existing profile sync was modified",
        2704: "An existing profile link preference was changed",
        2705: "Wireless profile share with UEFI enabled setting was changed",
        2800: "EAC Posture Signer SET",
        2801: "EAC Enabled",
        2802: "EAC Disabled",
        2803: "EAC Posture State",
        2804: "EAC Set Options",
        2900: "KVM Opt-in Enabled",
        2901: "KVM Opt-in Disabled",
        2902: "KVM Password Changed",
        2903: "KVM Consent Succeeded",
        2904: "KVM Consent Failed",
        3000: "Opt-In Policy Change",
        3001: "Send Consent Code Event",
        3002: "Start Opt-In Blocked Event",
        3301: "A user has modified the Watchdog Action settings",
        3302: "A user has modified a Watchdog to add, remove, or alter the Watchdog Action connected to it"
    }

    // Return human readable extended audit log data
    // TODO: Just put some of them here, but many more still need to be added, helpful link here:
    // https://software.intel.com/sites/manageability/AMT_Implementation_and_Reference_Guide/default.htm?turl=WordDocuments%2Fsecurityadminevents.htm
    obj.GetAuditLogExtendedDataStr = function (id, data) {
        if ((id == 1602 || id == 1604) && data.charCodeAt(0) == 0) { return data.substring(2, 2 + data.charCodeAt(1)); } // ACL Entry Added/Removed (Digest)
        if (id == 1603) { if (data.charCodeAt(1) == 0) { return data.substring(3); } return null; } // ACL Entry Modified
        if (id == 1605) { return ["Invalid ME access", "Invalid MEBx access"][data.charCodeAt(0)]; } // ACL Access with Invalid Credentials
        if (id == 1606) { var r = ["Disabled", "Enabled"][data.charCodeAt(0)]; if (data.charCodeAt(1) == 0) { r += ", " + data.substring(3); } return r;} // ACL Entry State
        if (id == 1607) { return "Remote " + ["NoAuth", "ServerAuth", "MutualAuth"][data.charCodeAt(0)] + ", Local " + ["NoAuth", "ServerAuth", "MutualAuth"][data.charCodeAt(1)]; } // TLS State Changed
        if (id == 1617) { return obj.RealmNames[ReadInt(data, 0)] + ", " + ["NoAuth", "Auth", "Disabled"][data.charCodeAt(4)]; } // Set Realm Authentication Mode
        if (id == 1619) { return ["BIOS", "MEBx", "Local MEI", "Local WSMAN", "Remote WSAMN"][data.charCodeAt(0)]; } // Intel AMT Unprovisioning Started
        if (id == 1900) { return "From " + ReadShort(data, 0) + '.' + ReadShort(data, 2) + '.' + ReadShort(data, 4) + '.' + ReadShort(data, 6) + " to " + ReadShort(data, 8) + '.' + ReadShort(data, 10) + '.' + ReadShort(data, 12) + '.' + ReadShort(data, 14); } // Firmware Updated
        if (id == 2100) { var t4 = new Date(); t4.setTime(ReadInt(data, 0) * 1000 + (new Date().getTimezoneOffset() * 60000)); return t4.toLocaleString(); } // Intel AMT Time Set
        if (id == 3000) { return "From " + ["None", "KVM", "All"][data.charCodeAt(0)] + " to " + ["None", "KVM", "All"][data.charCodeAt(1)]; } // Opt-In Policy Change
        if (id == 3001) { return ["Success", "Failed 3 times"][data.charCodeAt(0)]; } // Send Consent Code Event
        return null;
    }

    // Binary Windows SID -> "S-1-5-21-..." (for Kerberos audit-log initiators)
    function GetSidString(sid) {
        var r = 'S-' + sid.charCodeAt(0) + '-' + sid.charCodeAt(7);
        for (var i = 2; i < (sid.length / 4); i++) { r += '-' + ReadIntX(sid, i * 4); }
        return r;
    }

    obj.GetAuditLog = function (func) {
        obj.AMT_AuditLog_ReadRecords(1, _GetAuditLog0, [func, []]);
    }

    function _GetAuditLog0(stack, name, responses, status, tag) {
        if (status != 200) { tag[0](obj, [], status); return; }
        var ptr, i, e, x, r = tag[1], t = new Date(), TimeStamp;

        if (responses.Body['RecordsReturned'] > 0) {
            responses.Body['EventRecords'] = MakeToArray(responses.Body['EventRecords']);

            for (i in responses.Body['EventRecords']) {
                e = null;
                try { e = window.atob(responses.Body['EventRecords'][i]); } catch (ex) { console.log('Bad audit record: ' + responses.Body['EventRecords'][i]); }
                if (e == null) continue;
                x = { 'AuditAppID': ReadShort(e, 0), 'EventID': ReadShort(e, 2), 'InitiatorType': e.charCodeAt(4) };
                x['AuditApp'] = _AmtAuditStringTable[x['AuditAppID']];
                x['Event'] = _AmtAuditStringTable[(x['AuditAppID'] * 100) + x['EventID']];
                if (!x['Event']) x['Event'] = '#' + x['EventID'];

                // Read and process the initiator
                if (x['InitiatorType'] == 0) {
                    // HTTP digest
                    var userlen = e.charCodeAt(5);
                    x['Initiator'] = e.substring(6, 6 + userlen);
                    ptr = 6 + userlen;
                }
                if (x['InitiatorType'] == 1) {
                    // Kerberos
                    x['KerberosUserInDomain'] = ReadInt(e, 5);
                    var userlen = e.charCodeAt(9);
                    x['Initiator'] = GetSidString(e.substring(10, 10 + userlen));
                    ptr = 10 + userlen;
                }
                if (x['InitiatorType'] == 2) {
                    // Local (the UI escapes this field, so plain text — no markup)
                    x['Initiator'] = 'Local';
                    ptr = 5;
                }
                if (x['InitiatorType'] == 3) {
                    // KVM Default Port
                    x['Initiator'] = 'KVM Default Port';
                    ptr = 5;
                }
                if (x['InitiatorType'] > 3) {
                    // Unknown initiator type — best effort, don't derail the whole log.
                    x['Initiator'] = 'Unknown';
                    ptr = 5;
                }

                // Read timestamp
                TimeStamp = ReadInt(e, ptr);
                x['Time'] = new Date((TimeStamp + (t.getTimezoneOffset() * 60)) * 1000);
                ptr += 4;

                // Read network access
                x['MCLocationType'] = e.charCodeAt(ptr++);
                var netlen = e.charCodeAt(ptr++);
                x['NetAddress'] = e.substring(ptr, ptr + netlen);

                // Read extended data
                ptr += netlen;
                var exlen = e.charCodeAt(ptr++);
                x['Ex'] = e.substring(ptr, ptr + exlen);
                x['ExStr'] = obj.GetAuditLogExtendedDataStr((x['AuditAppID'] * 100) + x['EventID'], x['Ex']);

                r.push(x);
            }
        }
        if (responses.Body['TotalRecordCount'] > r.length) {
            obj.AMT_AuditLog_ReadRecords(r.length + 1, _GetAuditLog0, [tag[0], r]);
        } else {
            tag[0](obj, r, status);
        }
    }

    


    return obj;
}
