/* Hardware Inventory — chassis, BIOS, processors, memory, storage, with JSON export. */
(function () {
    var HW_CLASSES = ['CIM_Chassis', 'CIM_Chip', 'CIM_BIOSElement', 'CIM_Processor',
        'CIM_PhysicalMemory', 'CIM_MediaAccessDevice', 'CIM_PhysicalPackage'];

    Views.hardware = function (c, amt) {
        Comp.loading(c, 'Reading hardware inventory…');
        load(c, amt);
    };

    async function load(c, amt) {
        var map = (await Amt.batch(amt, HW_CLASSES)).map;
        var hw = {
            chassis: Amt.pickArr(map, 'CIM_Chassis')[0],
            bios: Amt.pickArr(map, 'CIM_BIOSElement')[0],
            procs: Amt.pickArr(map, 'CIM_Processor'),
            chips: Amt.pickArr(map, 'CIM_Chip'), // Manufacturer/Model live here, paired by index
            mem: Amt.pickArr(map, 'CIM_PhysicalMemory'),
            media: Amt.pickArr(map, 'CIM_MediaAccessDevice')
        };

        c.innerHTML =
            Comp.heading('Hardware Inventory', 'Physical components reported by Intel AMT.', '<div class="btn sm" id="hwExport">' + Icons.svg('download', 14) + ' Export JSON</div>') +
            '<div class="grid cols-2">' + chassisCard(hw.chassis) + biosCard(hw.bios) + '</div>' +
            spaced(processorsCard(hw.procs, hw.chips)) +
            spaced(memoryCard(hw.mem)) +
            spaced(storageCard(hw.media));

        document.getElementById('hwExport').addEventListener('click', function () {
            UI.download(Views.exportName('hardware') + '.json', JSON.stringify(toJson(hw), null, 2), 'application/json');
            UI.toast('Exported', 'Hardware inventory saved', 'good');
        });
    }

    function spaced(html) { return '<div style="margin-top:16px">' + html + '</div>'; }
    // Escape first (neutralise any markup), then apply trademark symbols so the resulting
    // &reg;/&trade; entities render instead of being double-escaped into literal text.
    function tm(x) { return x ? AmtData.trademarks(Comp.esc(x)) : null; }
    function procModel(p, q) { return q.Version || p.Version || p.OtherFamilyDescription || (q.ElementName && q.ElementName !== 'Managed System Processor Chip' ? q.ElementName : null); }

    function chassisCard(ch) {
        return Comp.card({ title: 'System & Chassis', body: Comp.kv([
            ['Manufacturer', ch ? tm(ch.Manufacturer) : null],
            ['Model', ch ? Comp.esc(ch.Model) : null],
            ['Chassis type', ch && ch.ChassisPackageType != null ? AmtData.chassisType(parseInt(ch.ChassisPackageType)) : null],
            ['Serial number', ch ? Comp.esc(ch.SerialNumber) : null, true],
            ['Asset tag', ch ? Comp.esc(ch.Tag) : null],
            ['Version', ch ? Comp.esc(ch.Version) : null]
        ]) });
    }
    function biosCard(b) {
        return Comp.card({ title: 'BIOS / Firmware', body: Comp.kv([
            ['Vendor', b ? tm(b.Manufacturer) : null],
            ['Version', b ? Comp.esc(b.Version) : null, true],
            ['Release date', b && b.ReleaseDate ? Comp.esc(AmtData.cimDate(b.ReleaseDate)) : null],
            ['Primary BIOS', b ? Comp.boolBadge(b.PrimaryBIOS) : null]
        ]) });
    }
    function processorsCard(procs, chips) {
        var table = Comp.table([
            { label: 'Manufacturer', get: function (p, i) { return tm((chips[i] || {}).Manufacturer || p.Manufacturer); } },
            { label: 'Model', get: function (p, i) { return tm(procModel(p, chips[i] || {})); } },
            { label: 'Family', get: function (p) { return AmtData.procFamily(parseInt(p.Family)); } },
            { label: 'Max Speed', get: function (p) { return p.MaxClockSpeed ? Comp.esc(p.MaxClockSpeed) + ' MHz' : null; } },
            { label: 'Status', get: function (p) { return AmtData.cpuStatus(parseInt(p.CPUStatus)); } }
        ], procs, { empty: 'No processor data.' });
        return Comp.card({ title: 'Processors (' + procs.length + ')', body: table });
    }
    function memoryCard(mem) {
        var total = 0;
        var table = Comp.table([
            { label: 'Bank', get: function (m) { return Comp.esc(m.BankLabel); } },
            { label: 'Manufacturer', get: function (m) { return Comp.esc(m.Manufacturer); } },
            { label: 'Size', get: function (m) { var cap = parseInt(m.Capacity); if (!isNaN(cap)) total += cap; return isNaN(cap) ? null : (cap / 0x100000) + ' MB'; } },
            { label: 'Type', get: function (m) { return AmtData.memType(parseInt(m.MemoryType)); } },
            { label: 'Form Factor', get: function (m) { return AmtData.memFormFactor(parseInt(m.FormFactor)); } },
            { label: 'Part Number', cls: 'mono', get: function (m) { return Comp.esc(m.PartNumber ? String(m.PartNumber).trim() : ''); } },
            { label: 'Serial', cls: 'mono', get: function (m) { return Comp.esc(m.SerialNumber); } }
        ], mem, { empty: 'No memory data.' });
        var footer = total ? '<div class="muted" style="margin-top:10px">Total installed: <b>' + (total / 0x100000) + ' MB</b></div>' : '';
        return Comp.card({ title: 'Memory Modules (' + mem.length + ')', body: table + footer });
    }
    function storageCard(media) {
        var table = Comp.table([
            { label: 'Name', get: function (m) { return Comp.esc(m.DeviceID || m.ElementName); } },
            { label: 'Max Media Size', get: function (m) { return m.MaxMediaSize ? UI.fmtBytes(parseInt(m.MaxMediaSize) * 1000) : null; } }
        ], media, { empty: 'No storage devices reported.' });
        return Comp.card({ title: 'Storage Devices (' + media.length + ')', body: table });
    }

    function toJson(hw) {
        return {
            exportedAt: new Date().toISOString(),
            system: hw.chassis ? { manufacturer: hw.chassis.Manufacturer, model: hw.chassis.Model, chassisType: hw.chassis.ChassisPackageType != null ? AmtData.chassisType(parseInt(hw.chassis.ChassisPackageType)) : null, serialNumber: hw.chassis.SerialNumber, assetTag: hw.chassis.Tag, version: hw.chassis.Version } : null,
            bios: hw.bios ? { vendor: hw.bios.Manufacturer, version: hw.bios.Version, releaseDate: AmtData.cimDate(hw.bios.ReleaseDate), primary: hw.bios.PrimaryBIOS } : null,
            processors: hw.procs.map(function (p, i) { var q = hw.chips[i] || {}; return { manufacturer: q.Manufacturer || p.Manufacturer, model: procModel(p, q), family: AmtData.procFamily(parseInt(p.Family)), familyCode: p.Family, maxClockSpeedMHz: p.MaxClockSpeed, status: AmtData.cpuStatus(parseInt(p.CPUStatus)) }; }),
            memory: hw.mem.map(function (m) { var cap = parseInt(m.Capacity); return { bank: m.BankLabel, manufacturer: m.Manufacturer, sizeMB: isNaN(cap) ? null : cap / 0x100000, type: AmtData.memType(parseInt(m.MemoryType)), formFactor: AmtData.memFormFactor(parseInt(m.FormFactor)), partNumber: m.PartNumber ? String(m.PartNumber).trim() : null, serialNumber: m.SerialNumber }; }),
            storage: hw.media.map(function (m) { return { name: m.DeviceID || m.ElementName, maxMediaSizeBytes: m.MaxMediaSize ? parseInt(m.MaxMediaSize) * 1000 : null }; })
        };
    }
})();
