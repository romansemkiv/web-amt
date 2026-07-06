/* WebAMT — Intel AMT data decoders and formatting helpers */
var AmtData = (function () {

    // CIM AssociatedPowerManagementService PowerState -> label + class
    // (values reported by CIM_ServiceAvailableToElement.PowerState)
    var powerStates = {
        1: ['Other', 'sleep'], 2: ['On', 'on'], 3: ['Sleep - Light', 'sleep'], 4: ['Sleep - Deep', 'sleep'],
        5: ['Power Cycle (Off Soft)', 'off'], 6: ['Off - Hard', 'off'], 7: ['Hibernate', 'sleep'],
        8: ['Off - Soft', 'off'], 9: ['Power Cycle (Off Hard)', 'off'], 10: ['Master Bus Reset', 'on'],
        11: ['Diagnostic Interrupt (NMI)', 'on'], 12: ['Off - Soft Graceful', 'off'], 13: ['Off - Hard Graceful', 'off'],
        14: ['Master Bus Reset Graceful', 'on'], 15: ['Power Cycle (Off Soft Graceful)', 'off'], 16: ['Power Cycle (Off Hard Graceful)', 'off']
    };
    function powerState(v) { return powerStates[v] || ['Unknown', 'off']; }

    var memType = ["Unknown", "Other", "DRAM", "Synchronous DRAM", "Cache DRAM", "EDO", "EDRAM", "VRAM", "SRAM", "RAM", "ROM", "Flash", "EEPROM", "FEPROM", "EPROM", "CDRAM", "3DRAM", "SDRAM", "SGRAM", "RDRAM", "DDR", "DDR-2", "BRAM", "FB-DIMM", "DDR3", "FBD2", "DDR4", "LPDDR", "LPDDR2", "LPDDR3", "LPDDR4"];
    var memFormFactor = ['', "Other", "Unknown", "SIMM", "SIP", "Chip", "DIP", "ZIP", "Proprietary Card", "DIMM", "TSOP", "Row of chips", "RIMM", "SODIMM", "SRIMM", "FB-DIM"];
    var cpuStatus = ["Unknown", "Enabled", "Disabled by User", "Disabled by BIOS (POST Error)", "Idle", "Other"];
    var chassisTypes = ['', 'Other', 'Unknown', 'Desktop', 'Low Profile Desktop', 'Pizza Box', 'Mini Tower', 'Tower', 'Portable', 'Laptop', 'Notebook', 'Hand Held', 'Docking Station', 'All in One', 'Sub Notebook', 'Space-Saving', 'Lunch Box', 'Main System Chassis', 'Expansion Chassis', 'SubChassis', 'Bus Expansion Chassis', 'Peripheral Chassis', 'Storage Chassis', 'Rack Mount Chassis', 'Sealed-Case PC', 'Multi-system Chassis', 'Compact PCI', 'Advanced TCA', 'Blade', 'Blade Enclosure', 'Tablet', 'Convertible', 'Detachable'];
    // SMBIOS (DSP0134) processor family enum — common values
    var procFamily = {
        1: 'Other', 2: 'Unknown',
        191: "Intel&reg; Core&trade; 2 Duo", 192: "Intel&reg; Core&trade; 2 Solo", 193: "Intel&reg; Core&trade; 2 Extreme", 194: "Intel&reg; Core&trade; 2 Quad",
        195: "Intel&reg; Core&trade; 2 Extreme mobile", 196: "Intel&reg; Core&trade; 2 Duo mobile", 197: "Intel&reg; Core&trade; 2 Solo mobile", 198: "Intel&reg; Core&trade; i7", 199: "Dual-Core Intel&reg; Celeron&reg;",
        200: "Intel&reg; Core&trade; i5", 205: "Intel&reg; Core&trade; i5", 206: "Intel&reg; Core&trade; i3", 207: "Intel&reg; Core&trade; i9",
        210: "Intel&reg; Core&trade; i5", 211: "Intel&reg; Core&trade; i5", 212: "Intel&reg; Core&trade; i5",
        213: "Intel&reg; Core&trade; m", 214: "Intel&reg; Core&trade; m3", 215: "Intel&reg; Core&trade; m5", 216: "Intel&reg; Core&trade; m7",
        221: "Intel&reg; Xeon&reg;", 222: "Intel&reg; Xeon&reg; 3200", 228: "Intel&reg; Atom&trade;"
    };

    // AMT provisioning / setup state
    var provisioningStates = { 0: 'Pre-Provisioning (Factory)', 1: 'In-Provisioning', 2: 'Post-Provisioning (Operational)' };
    var provisioningModes = { 1: 'Admin Control Mode (ACM)', 4: 'Client Control Mode (CCM)' };

    function trademarks(x) { return x == null ? '' : String(x).replace(/\(R\)/g, '&reg;').replace(/\(TM\)/g, '&trade;'); }

    // AMT UUID bytes -> canonical GUID string
    function guidToStr(g) {
        if (!g) return '';
        return g.substring(6, 8) + g.substring(4, 6) + g.substring(2, 4) + g.substring(0, 2) + '-' + g.substring(10, 12) + g.substring(8, 10) + '-' + g.substring(14, 16) + g.substring(12, 14) + '-' + g.substring(16, 20) + '-' + g.substring(20);
    }
    // Convert base64 UUID (from CIM_ComputerSystemPackage.PlatformGUID may be hex) to string
    function uuidFromHex(hex) { try { return guidToStr(hex.toLowerCase()); } catch (e) { return hex; } }

    // AMT version string from software identity / general settings
    function parseAmtVersion(str) { if (!str) return null; var m = String(str).match(/(\d+\.\d+\.\d+)/); return m ? m[1] : str; }

    // A CIM datetime — returned by AMT as a raw string or { Datetime } / { Value } — to a date.
    function cimDate(d) {
        if (d == null) return '';
        if (typeof d === 'object') { d = d.Datetime || d.Value || d['@Datetime'] || ''; }
        var s = String(d);
        if (s.indexOf('-') >= 0 && s.indexOf('T') >= 0) { var dt = new Date(s); return isNaN(dt) ? s.substring(0, 10) : dt.toLocaleDateString(); }
        if (/^\d{8}/.test(s)) return s.substring(0, 4) + '-' + s.substring(4, 6) + '-' + s.substring(6, 8);
        var dt2 = new Date(s); return isNaN(dt2) ? s : dt2.toLocaleDateString();
    }

    return {
        powerState: powerState,
        memType: function (i) { return memType[i] || 'Unknown'; },
        memFormFactor: function (i) { return memFormFactor[i] || 'Unknown'; },
        cpuStatus: function (i) { return cpuStatus[i] || 'Unknown'; },
        chassisType: function (i) { return chassisTypes[i] || ('Type ' + i); },
        procFamily: function (i) { return procFamily[i] || ('Family ' + i); },
        provisioningState: function (i) { return provisioningStates[i] || ('State ' + i); },
        provisioningMode: function (i) { return provisioningModes[i] || ('Mode ' + i); },
        trademarks: trademarks,
        guidToStr: guidToStr,
        uuidFromHex: uuidFromHex,
        parseAmtVersion: parseAmtVersion,
        cimDate: cimDate
    };
})();
