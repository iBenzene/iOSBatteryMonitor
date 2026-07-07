#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { appendFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST_DIR = path.join(SCRIPT_DIR, "ui", "dist");
const UI_PUBLIC_DIR = path.join(SCRIPT_DIR, "ui");
const DATA_DIR = path.join(SCRIPT_DIR, "data");
const BATTERY_LOG_PATH = path.join(DATA_DIR, "battery_log.jsonl");
const DEVICES_PATH = path.join(DATA_DIR, "devices.json");

const DEFAULT_COLLECTION_INTERVAL = 300;
const DEFAULT_DISCOVERY_INTERVAL = 60;
const DEMO_DEVICE_UDID = "DEMO-0000-BATTERY-LAB";

const BATTERY_FIELDS = [
    "NominalChargeCapacity",
    "FullChargeCapacity",
    "FccComp1",
    "FccComp2",
    "AppleRawMaxCapacity",
    "DesignCapacity",
    "CycleCount",
    "QmaxCell0",
    "Qmax",
    "MaximumCapacityPercent",
    "BatteryHealthMetric",
    "StateOfCharge",
    "CurrentCapacity",
    "TrueRemainingCapacity",
    "AppleRawCurrentCapacity",
    "Voltage",
    "AppleRawBatteryVoltage",
    "Amperage",
    "InstantAmperage",
    "Current",
    "Temperature",
    "WeightedRa",
    "ChemicalWeightedRa",
    "IsCharging",
    "ExternalConnected",
    "Serial",
];

const NUMERIC_COLUMNS = [
    "NominalChargeCapacity",
    "FullChargeCapacity",
    "FccComp1",
    "FccComp2",
    "AppleRawMaxCapacity",
    "DesignCapacity",
    "CycleCount",
    "QmaxCell0",
    "MaximumCapacityPercent",
    "BatteryHealthMetric",
    "StateOfCharge",
    "CurrentCapacity",
    "TrueRemainingCapacity",
    "AppleRawCurrentCapacity",
    "Voltage",
    "AppleRawBatteryVoltage",
    "Amperage",
    "InstantAmperage",
    "Current",
    "Temperature",
    "ChemicalWeightedRa",
];

const DEDUPE_FIELDS = [
    "UDID",
    "Timestamp",
    "NominalChargeCapacity",
    "FullChargeCapacity",
    "DesignCapacity",
    "CycleCount",
    "QmaxCell0",
    "StateOfCharge",
    "TrueRemainingCapacity",
    "AppleRawCurrentCapacity",
    "Voltage",
    "Temperature",
];

const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
};

const stableFieldValue = value => {
    if (Array.isArray(value)) return JSON.stringify(value);
    if (value === null || value === undefined) return "";
    return String(value);
};

const readingDedupeKey = row => DEDUPE_FIELDS.map(field => stableFieldValue(row?.[field])).join("|");

const nowIso = () => {
    const date = new Date();
    return localIso(date);
};

const localIso = date => {
    const pad = value => String(value).padStart(2, "0");
    return (
        [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("-") +
        `T${[pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join(":")}`
    );
};

const parseTimeParam = value => {
    if (!value) return null;
    if (/^\d+$/.test(String(value))) {
        const parsed = new Date(Number(value));
        return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const commandExists = name => {
    const candidates = (process.env.PATH || "").split(path.delimiter).map(dir => path.join(dir, name));
    if (os.platform() === "win32") {
        candidates.push(
            ...(process.env.PATH || "")
                .split(path.delimiter)
                .flatMap(dir => [".exe", ".cmd", ".bat"].map(ext => path.join(dir, `${name}${ext}`)))
        );
    }
    return candidates.some(candidate => existsSync(candidate));
};

const requireTool = name => {
    if (commandExists(name)) return;
    throw new Error(
        [
            `Missing dependency: ${name}`,
            "macOS: brew install libimobiledevice",
            "Windows: install libimobiledevice tools with MSYS2 or a trusted native build, then add them to PATH.",
        ].join("\n")
    );
};

const runCommand = (args, timeout = 15_000) =>
    new Promise(resolve => {
        const [command, ...rest] = args;
        const child = execFile(command, rest, { encoding: "buffer", timeout }, (error, stdout, stderr) => {
            resolve({
                code: typeof error?.code === "number" ? error.code : error ? 1 : 0,
                stderr: Buffer.from(stderr || []).toString("utf8"),
                stdout: Buffer.from(stdout || []).toString("utf8"),
                timedOut: Boolean(error?.killed),
            });
        });
        child.on("error", error => {
            resolve({ code: 1, stderr: error.message, stdout: "", timedOut: false });
        });
    });

const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const coerceValue = value => {
    if (value === undefined || value === null) return value;
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (Array.isArray(value)) return value.map(coerceValue);
    const text = String(value).trim();
    if (/^[-+]?\d+$/.test(text)) return Number.parseInt(text, 10);
    if (/^[-+]?\d+\.\d+$/.test(text)) return Number.parseFloat(text);
    return text;
};

const parseScalarXml = (output, key) => {
    const escaped = escapeRegex(key);
    const scalar = new RegExp(`<key>${escaped}</key>\\s*<(integer|real|string)>([^<]+)</\\1>`, "s").exec(output);
    if (scalar) return coerceValue(scalar[2]);
    if (new RegExp(`<key>${escaped}</key>\\s*<true\\s*/>`, "s").test(output)) return true;
    if (new RegExp(`<key>${escaped}</key>\\s*<false\\s*/>`, "s").test(output)) return false;
    return undefined;
};

const parseArrayXml = (output, key) => {
    const escaped = escapeRegex(key);
    const match = new RegExp(`<key>${escaped}</key>\\s*<array>(.*?)</array>`, "s").exec(output);
    if (!match) return undefined;
    const values = [];
    const itemRegex = /<(integer|real|string)>([^<]+)<\/\1>/g;
    for (const item of match[1].matchAll(itemRegex)) values.push(coerceValue(item[2]));
    return values.length ? values : undefined;
};

const parseTextValue = (output, key) => {
    const escaped = escapeRegex(key);
    const patterns = [
        new RegExp(`"${escaped}"\\s*=\\s*("?[-+]?\\d+(?:\\.\\d+)?"?)`),
        new RegExp(`${escaped}\\s*=\\s*("?[-+]?\\d+(?:\\.\\d+)?"?)`),
    ];
    for (const pattern of patterns) {
        const match = pattern.exec(output);
        if (match) return coerceValue(match[1].replace(/^"|"$/g, ""));
    }
    return undefined;
};

const parseBatteryOutput = output => {
    const found = {};
    for (const key of BATTERY_FIELDS) {
        const arrayValue = parseArrayXml(output, key);
        if (arrayValue !== undefined) {
            found[key] = arrayValue;
            continue;
        }
        const scalarValue = parseScalarXml(output, key);
        if (scalarValue !== undefined) {
            found[key] = scalarValue;
            continue;
        }
        const textValue = parseTextValue(output, key);
        if (textValue !== undefined) found[key] = textValue;
    }

    if (found.QmaxCell0 === undefined && Array.isArray(found.Qmax) && found.Qmax.length) {
        found.QmaxCell0 = coerceValue(found.Qmax[0]);
    }

    for (const key of ["FullChargeCapacity", "FccComp1", "FccComp2", "AppleRawMaxCapacity"]) {
        const value = found[key];
        if (key === "FullChargeCapacity" && typeof value === "number" && value > 1000) break;
        if (key !== "FullChargeCapacity" && typeof value === "number" && value > 1000) {
            found.FullChargeCapacity = value;
            break;
        }
    }

    return found;
};

const deviceId = device => device.udid;

const deviceDisplayName = device => device.label || device.product_type || device.udid.slice(-8);

const connectionRank = connection => (connection === "usb" ? 0 : connection === "network" ? 1 : 2);

const normalizeConnections = device => {
    const values = new Set(device.connections || []);
    if (device.connection) values.add(device.connection);
    return [...values].sort((a, b) => connectionRank(a) - connectionRank(b));
};

const connectionLabel = device => {
    const connections = normalizeConnections(device);
    return connections.length ? connections.join(" + ") : device.connection || "";
};

const mergeDevice = (existing, incoming) => {
    const connections = [...new Set([...normalizeConnections(existing || {}), ...normalizeConnections(incoming)])].sort(
        (a, b) => connectionRank(a) - connectionRank(b)
    );
    const preferredConnection = connections[0] || incoming.connection || existing?.connection || "";
    return {
        ...existing,
        ...incoming,
        build_version: incoming.build_version || existing?.build_version || "",
        connection: preferredConnection,
        connection_label: connections.join(" + "),
        connections,
        label: incoming.label || existing?.label || "",
        product_type: incoming.product_type || existing?.product_type || "",
        product_version: incoming.product_version || existing?.product_version || "",
        udid: incoming.udid || existing?.udid || "",
    };
};

const mergeDiscoveredDevices = devices => {
    const merged = new Map();
    for (const device of devices) {
        merged.set(device.udid, mergeDevice(merged.get(device.udid), device));
    }
    return [...merged.values()];
};

const parseDeviceLines = (output, defaultConnection) =>
    output
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => !line.startsWith("("))
        .map(line => {
            const match = /^(\S+)(?:\s+\(([^)]+)\))?$/.exec(line);
            if (!match) return null;
            const marker = (match[2] || "").toLowerCase();
            let connection = defaultConnection;
            if (marker.includes("network")) connection = "network";
            if (marker.includes("usb")) connection = "usb";
            return { build_version: "", connection, label: "", product_type: "", product_version: "", udid: match[1] };
        })
        .filter(Boolean);

const readDeviceInfo = async (device, timeout = 10_000) => {
    if (!commandExists("ideviceinfo")) return {};
    const command = ["ideviceinfo", "-u", device.udid];
    if (device.connection === "network") command.push("-n");
    const { code, stdout } = await runCommand(command, timeout);
    if (code !== 0) return {};
    const info = {};
    const wanted = new Set(["DeviceName", "ProductType", "ProductVersion", "BuildVersion"]);
    for (const line of stdout.split(/\r?\n/)) {
        const index = line.indexOf(": ");
        if (index < 0) continue;
        const key = line.slice(0, index);
        const value = line.slice(index + 2);
        if (wanted.has(key)) info[key] = value;
    }
    return info;
};

const enrichDevice = async device => {
    const info = await readDeviceInfo(device);
    return {
        ...device,
        build_version: info.BuildVersion || device.build_version || "",
        label: info.DeviceName || device.label || "",
        product_type: info.ProductType || device.product_type || "",
        product_version: info.ProductVersion || device.product_version || "",
    };
};

const discoverDevices = async (mode = "auto", timeout = 8_000) => {
    requireTool("idevice_id");
    const commands = [];
    if (mode === "auto" || mode === "usb") commands.push({ args: ["idevice_id", "-l"], connection: "usb" });
    if (mode === "auto" || mode === "network")
        commands.push({ args: ["idevice_id", "-n", "-l"], connection: "network" });

    const seen = new Set();
    const devices = [];
    for (const command of commands) {
        const { code, stdout, stderr } = await runCommand(command.args, timeout);
        if (code !== 0 && mode !== "auto")
            throw new Error(stderr.trim() || stdout.trim() || `${command.args.join(" ")} failed`);
        for (const device of parseDeviceLines(stdout, command.connection)) {
            const id = `${device.udid}:${device.connection}`;
            if (seen.has(id)) continue;
            seen.add(id);
            devices.push(await enrichDevice(device));
        }
    }
    return mergeDiscoveredDevices(devices);
};

const diagnosticBase = (device, mode = "auto") => {
    const base = ["idevicediagnostics"];
    if (device) {
        base.push("-u", device.udid);
        if (device.connection === "network") base.push("-n");
    } else if (mode === "network") {
        base.push("-n");
    }
    return base;
};

const readBattery = async (device = null, mode = "auto", timeout = 15_000) => {
    requireTool("idevicediagnostics");
    let attempts = [];
    if (device) {
        attempts.push({ device, mode: device.connection });
    } else if (mode === "auto") {
        const devices = await discoverDevices("auto", 8_000);
        attempts = devices.map(candidate => ({ device: candidate, mode: candidate.connection }));
        if (!attempts.length) attempts.push({ device: null, mode: "network" }, { device: null, mode: "usb" });
    } else {
        const devices = await discoverDevices(mode, 8_000);
        attempts = devices.map(candidate => ({ device: candidate, mode: candidate.connection }));
        if (!attempts.length) attempts.push({ device: null, mode });
    }

    const errors = [];
    for (const attempt of attempts) {
        const base = diagnosticBase(attempt.device, attempt.mode);
        const commands = [
            [...base, "ioregentry", "AppleSmartBattery"],
            [...base, "ioreg", "IOService"],
        ];
        for (const command of commands) {
            const result = await runCommand(command, timeout);
            const data = parseBatteryOutput(result.stdout);
            if (result.code === 0 && Object.keys(data).length) {
                return { data, device: attempt.device, raw: result.stdout, source: command.join(" ") };
            }
            const detail = result.stderr.trim() || result.stdout.trim().slice(0, 300) || `exit=${result.code}`;
            errors.push(`${command.join(" ")}: ${detail}`);
        }
    }
    throw new Error(errors.join("\n"));
};

const rowFromData = (data, device, source) => ({
    source,
    Timestamp: nowIso(),
    ...(device
        ? {
              BuildVersion: device.build_version,
              Connection: device.connection,
              DeviceName: device.label,
              ProductType: device.product_type,
              ProductVersion: device.product_version,
              UDID: device.udid,
          }
        : {}),
    ...data,
});

const createDemoDataset = () => {
    const device = {
        build_version: "Demo",
        connection: "demo",
        connection_label: "demo",
        connections: ["demo"],
        demo: true,
        first_seen: localIso(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)),
        id: DEMO_DEVICE_UDID,
        last_seen: nowIso(),
        latest: null,
        latest_timestamp: null,
        name: "测试设备",
        online: true,
        product_type: "iPad Demo,1",
        product_version: "26.5",
        udid: DEMO_DEVICE_UDID,
    };
    const readings = [];
    const start = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const intervalMs = 10 * 60 * 1000;
    const count = Math.floor((90 * 24 * 60 * 60 * 1000) / intervalMs);
    const design = 10770;
    for (let index = 0; index <= count; index += 1) {
        const timeMs = start + index * intervalMs;
        const day = index / 144;
        const hourOfDay = (index % 144) / 6;
        const cyclePhase = (index % 96) / 96;
        const triangle = cyclePhase < 0.5 ? cyclePhase * 2 : (1 - cyclePhase) * 2;
        const stateOfCharge = Math.max(3, Math.min(100, Math.round(5 + triangle * 94 + Math.sin(index / 17) * 2)));
        const nominal = Math.round(8580 - day * 1.8 + Math.sin(index / 19) * 14 + Math.sin(index / 173) * 28);
        const full = Math.round(8370 - day * 1.55 + Math.sin(index / 23) * 12 + Math.cos(index / 139) * 18);
        const qmax = Math.round(9605 - day * 0.75 + Math.sin(index / 211) * 10);
        const tempC =
            31 +
            Math.sin((hourOfDay / 24) * Math.PI * 2) * 3.8 +
            (stateOfCharge > 82 ? 4.5 : 0) +
            Math.sin(index / 9) * 0.8;
        const cycleCount = 1647 + Math.floor(day * 1.35);
        const timestamp = localIso(new Date(timeMs));
        const data = {
            AppleRawBatteryVoltage: Math.round(3400 + stateOfCharge * 8.4 + Math.sin(index / 7) * 18),
            AppleRawMaxCapacity: full,
            BatteryHealthMetric: 71,
            BuildVersion: device.build_version,
            Connection: device.connection,
            CurrentCapacity: stateOfCharge,
            CycleCount: cycleCount,
            DesignCapacity: design,
            DeviceName: device.name,
            ExternalConnected: cyclePhase < 0.54,
            FccComp1: full,
            FccComp2: full,
            FullChargeCapacity: full,
            IsCharging: cyclePhase < 0.5,
            NominalChargeCapacity: nominal,
            ProductType: device.product_type,
            ProductVersion: device.product_version,
            Qmax: [qmax],
            QmaxCell0: qmax,
            Serial: "DEMO-BATTERY-SERIAL",
            source: "demo AppleSmartBattery generator",
            StateOfCharge: stateOfCharge,
            Temperature: Math.round(tempC * 100),
            Timestamp: timestamp,
            UDID: device.udid,
            Voltage: Math.round(3400 + stateOfCharge * 8.4 + Math.sin(index / 7) * 18),
        };
        const item = {
            build_version: device.build_version,
            connection: device.connection,
            data,
            demo: true,
            device_id: device.udid,
            device_name: device.name,
            id: `demo-${index + 1}`,
            product_type: device.product_type,
            product_version: device.product_version,
            source: data.source,
            timestamp,
            udid: device.udid,
        };
        for (const column of NUMERIC_COLUMNS) {
            item[column] = typeof data[column] === "number" && Number.isFinite(data[column]) ? data[column] : null;
        }
        readings.push(item);
    }
    const latest = readings.at(-1);
    device.latest_timestamp = latest?.timestamp || null;
    device.latest = latest?.data || null;
    return { device, readings };
};

class BatteryStore {
    constructor(options = {}) {
        mkdirSync(DATA_DIR, { recursive: true });
        this.readings = [];
        this.readingKeys = new Set();
        this.devices = new Map();
        this.nextId = 1;
        this.demoData = Boolean(options.demoData);
        this.demo = this.demoData ? createDemoDataset() : { device: null, readings: [] };
        this.loadDevices();
        this.loadReadings();
    }

    loadDevices() {
        if (!existsSync(DEVICES_PATH)) return;
        try {
            const items = JSON.parse(readFileSync(DEVICES_PATH, "utf8"));
            for (const item of items) {
                const udid = item.udid || String(item.id || "").split(":")[0];
                if (!udid) continue;
                const existing = this.devices.get(udid);
                const merged = mergeDevice(existing, {
                    ...item,
                    connection: item.connection || String(item.id || "").split(":")[1] || "",
                    id: udid,
                    label: item.name || item.label || "",
                    udid,
                });
                this.devices.set(udid, {
                    ...merged,
                    first_seen: existing?.first_seen || item.first_seen || nowIso(),
                    id: udid,
                    last_seen: [existing?.last_seen, item.last_seen].filter(Boolean).sort().at(-1) || nowIso(),
                    latest: existing?.latest || item.latest || null,
                    latest_timestamp: existing?.latest_timestamp || item.latest_timestamp || null,
                    name: merged.label,
                });
            }
        } catch {
            this.devices.clear();
        }
    }

    loadReadings() {
        if (!existsSync(BATTERY_LOG_PATH)) return;
        const lines = readFileSync(BATTERY_LOG_PATH, "utf8").split(/\r?\n/).filter(Boolean);
        for (const line of lines) {
            try {
                const item = JSON.parse(line);
                this.readings.push(item);
                this.readingKeys.add(readingDedupeKey(item.data || item));
                this.nextId = Math.max(this.nextId, Number(item.id || 0) + 1);
            } catch {
                // Ignore a damaged partial line.
            }
        }
        for (const reading of this.readings) {
            const id = reading.udid || String(reading.device_id || "").split(":")[0];
            if (!id) continue;
            const existing = this.devices.get(id);
            if (existing) {
                existing.latest_timestamp = reading.timestamp;
                existing.latest = reading.data;
            }
        }
    }

    async saveDevices() {
        await writeFile(DEVICES_PATH, JSON.stringify([...this.devices.values()], null, 2), "utf8");
    }

    async upsertDevice(device) {
        const id = deviceId(device);
        const current = nowIso();
        const previous = this.devices.get(id);
        const merged = mergeDevice(
            previous
                ? {
                      ...previous,
                      label: previous.name || previous.label || "",
                  }
                : null,
            device
        );
        this.devices.set(id, {
            build_version: merged.build_version,
            connection: merged.connection,
            connection_label: merged.connection_label,
            connections: merged.connections,
            first_seen: previous?.first_seen || current,
            id,
            last_seen: current,
            latest: previous?.latest || null,
            latest_timestamp: previous?.latest_timestamp || null,
            name: merged.label,
            product_type: merged.product_type,
            product_version: merged.product_version,
            udid: merged.udid,
        });
        await this.saveDevices();
    }

    async addReading(row) {
        const device_id = row.UDID || "";
        const dedupeKey = readingDedupeKey(row);
        if (this.readingKeys.has(dedupeKey)) return null;
        const item = {
            build_version: row.BuildVersion || "",
            connection: row.Connection || "",
            data: row,
            device_id,
            device_name: row.DeviceName || "",
            id: this.nextId++,
            product_type: row.ProductType || "",
            product_version: row.ProductVersion || "",
            source: row.source || "",
            timestamp: row.Timestamp,
            udid: row.UDID || "",
        };
        for (const column of NUMERIC_COLUMNS) {
            item[column] = typeof row[column] === "number" && Number.isFinite(row[column]) ? row[column] : null;
        }
        this.readings.push(item);
        this.readingKeys.add(dedupeKey);
        await appendFile(BATTERY_LOG_PATH, `${JSON.stringify(item)}\n`, "utf8");

        if (device_id && this.devices.has(device_id)) {
            const device = this.devices.get(device_id);
            device.latest_timestamp = item.timestamp;
            device.latest = row;
            await this.saveDevices();
        }
        return item;
    }

    deviceList() {
        const devices = [...this.devices.values()];
        if (this.demoData && this.demo.device) devices.push(this.demo.device);
        return devices.sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)));
    }

    readingList({ limit = 500, deviceId: selectedDeviceId = "", from = null, to = null } = {}) {
        const capped = Math.max(1, Math.min(Number(limit) || 500, 20000));
        const fromMs = parseTimeParam(from);
        const toMs = parseTimeParam(to);
        let rows = this.demoData ? [...this.readings, ...this.demo.readings] : this.readings;
        if (selectedDeviceId) {
            rows = rows.filter(reading => {
                const id = reading.udid || String(reading.device_id || "").split(":")[0];
                return id === selectedDeviceId || reading.device_id === selectedDeviceId;
            });
        }
        if (fromMs !== null || toMs !== null) {
            rows = rows.filter(reading => {
                const time = parseTimeParam(reading.timestamp);
                if (time === null) return false;
                if (fromMs !== null && time < fromMs) return false;
                if (toMs !== null && time > toMs) return false;
                return true;
            });
        }
        return rows.slice(-capped);
    }

    counts() {
        return {
            devices: this.devices.size + (this.demoData && this.demo.device ? 1 : 0),
            readings: this.readings.length + (this.demoData ? this.demo.readings.length : 0),
        };
    }
}

class MonitorService {
    constructor(store, options = {}) {
        this.store = store;
        this.mode = options.mode || "auto";
        this.collectionInterval = options.collectionInterval || DEFAULT_COLLECTION_INTERVAL;
        this.discoveryInterval = options.discoveryInterval || DEFAULT_DISCOVERY_INTERVAL;
        this.timeout = options.timeout || 15_000;
        this.visibleDevices = new Map();
        this.lastError = "";
        this.lastDiscoveryAt = "";
        this.lastCollectionAt = "";
        this.nextDiscoveryAt = "";
        this.nextCollectionAt = "";
        this.running = false;
        this.stopped = false;
        this.subscribers = new Set();
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.loop();
    }

    stop() {
        this.stopped = true;
        this.running = false;
        for (const response of this.subscribers) response.end();
        this.subscribers.clear();
    }

    status() {
        return {
            collectionInterval: this.collectionInterval,
            discoveryInterval: this.discoveryInterval,
            lastCollectionAt: this.lastCollectionAt,
            lastDiscoveryAt: this.lastDiscoveryAt,
            lastError: this.lastError,
            mode: this.mode,
            nextCollectionAt: this.nextCollectionAt,
            nextDiscoveryAt: this.nextDiscoveryAt,
            paths: {
                batteryLog: BATTERY_LOG_PATH,
                devices: DEVICES_PATH,
                uiDist: UI_DIST_DIR,
            },
            running: this.running,
            tools: {
                idevice_id: commandExists("idevice_id"),
                idevicediagnostics: commandExists("idevicediagnostics"),
                ideviceinfo: commandExists("ideviceinfo"),
                idevicepair: commandExists("idevicepair"),
            },
            visibleDevices: [...this.visibleDevices.values()].map(device => ({
                ...device,
                displayName: deviceDisplayName(device),
                id: deviceId(device),
            })),
            ...this.store.counts(),
        };
    }

    subscribe(response) {
        this.subscribers.add(response);
        response.on("close", () => this.subscribers.delete(response));
    }

    broadcast(event, payload) {
        const message = JSON.stringify({ event, payload, timestamp: nowIso() });
        for (const response of this.subscribers) {
            response.write(`event: ${event}\n`);
            response.write(`data: ${message}\n\n`);
        }
    }

    async discoverOnce() {
        const devices = await discoverDevices(this.mode, 8_000);
        this.visibleDevices = new Map(devices.map(device => [deviceId(device), device]));
        this.lastDiscoveryAt = nowIso();
        this.nextDiscoveryAt = localIso(new Date(Date.now() + this.discoveryInterval * 1000));
        this.lastError = "";
        for (const device of devices) await this.store.upsertDevice(device);
        this.broadcast("devices", { devices: devices.map(device => ({ ...device, id: deviceId(device) })) });
        return devices;
    }

    async collectOnce() {
        let devices = [...this.visibleDevices.values()];
        if (!devices.length) devices = await this.discoverOnce();

        const rows = [];
        const errors = [];
        for (const device of devices) {
            try {
                const result = await readBattery(device, device.connection, this.timeout);
                let actualDevice = result.device || device;
                if (!actualDevice.label) actualDevice = await enrichDevice(actualDevice);
                await this.store.upsertDevice(actualDevice);
                const row = rowFromData(result.data, actualDevice, result.source);
                const stored = await this.store.addReading(row);
                if (stored) rows.push(row);
            } catch (error) {
                errors.push(`${deviceDisplayName(device)} [${device.connection}]: ${error.message}`);
            }
        }

        this.lastCollectionAt = nowIso();
        this.nextCollectionAt = localIso(new Date(Date.now() + this.collectionInterval * 1000));
        this.lastError = errors.join("\n");
        if (rows.length) this.broadcast("readings", { readings: rows });
        if (errors.length) this.broadcast("error", { message: this.lastError });
        return rows;
    }

    async loop() {
        let nextDiscovery = 0;
        let nextCollection = 0;
        while (!this.stopped) {
            const current = Date.now();
            try {
                if (current >= nextDiscovery) {
                    await this.discoverOnce();
                    nextDiscovery = current + this.discoveryInterval * 1000;
                }
                if (current >= nextCollection) {
                    await this.collectOnce();
                    nextCollection = current + this.collectionInterval * 1000;
                }
            } catch (error) {
                this.lastError = error.message || String(error);
                this.broadcast("error", { message: this.lastError });
                nextDiscovery = current + Math.min(30, this.discoveryInterval) * 1000;
                nextCollection = current + Math.min(30, this.collectionInterval) * 1000;
            }
            this.nextDiscoveryAt = localIso(new Date(nextDiscovery));
            this.nextCollectionAt = localIso(new Date(nextCollection));
            await sleep(1000);
        }
    }
}

const sendJson = (response, payload, statusCode = 200) => {
    const body = Buffer.from(JSON.stringify(payload), "utf8");
    response.writeHead(statusCode, {
        "Access-Control-Allow-Origin": "*",
        "Content-Length": body.length,
        "Content-Type": "application/json; charset=utf-8",
    });
    response.end(body);
};

const collectBody = request =>
    new Promise(resolve => {
        const chunks = [];
        request.on("data", chunk => chunks.push(chunk));
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

const serveStatic = (request, response, pathname) => {
    const root = existsSync(UI_DIST_DIR) ? UI_DIST_DIR : UI_PUBLIC_DIR;
    const cleanPath = decodeURIComponent(pathname.replace(/^\/+/, ""));
    let target = path.resolve(root, cleanPath || "index.html");
    if (!target.startsWith(path.resolve(root))) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
    }
    if (!existsSync(target) || statSync(target).isDirectory()) {
        target = path.join(root, "index.html");
    }
    if (!existsSync(target)) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Frontend is not built yet. Run: npm install && npm run build");
        return;
    }
    const type = MIME_TYPES[path.extname(target)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": type });
    if (request.method === "HEAD") {
        response.end();
        return;
    }
    createReadStream(target).pipe(response);
};

const createServer = (monitor, store) =>
    http.createServer(async (request, response) => {
        try {
            const parsed = new URL(request.url || "/", "http://127.0.0.1");
            const pathname = parsed.pathname || "/";
            const params = parsed.searchParams;

            if (request.method === "OPTIONS") {
                response.writeHead(204, {
                    "Access-Control-Allow-Headers": "Content-Type",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Origin": "*",
                });
                response.end();
                return;
            }

            if (request.method === "GET" && pathname === "/api/status") return sendJson(response, monitor.status());
            if (request.method === "GET" && pathname === "/api/devices") {
                const visibleDevices = monitor.status().visibleDevices;
                const visibleById = new Map(visibleDevices.map(device => [device.id, device]));
                const devices = store.deviceList().map(device => {
                    if (device.demo) {
                        return {
                            ...device,
                            connection_label: "demo",
                            current_connection: "demo",
                            current_connections: ["demo"],
                            online: true,
                        };
                    }
                    const visible = visibleById.get(device.id);
                    if (!visible) {
                        return {
                            ...device,
                            connection_label: "离线",
                            current_connection: "",
                            current_connections: [],
                            online: false,
                        };
                    }
                    return {
                        ...device,
                        ...visible,
                        connection_label: visible.connection_label || connectionLabel(visible),
                        current_connection: visible.connection,
                        current_connections: visible.connections || (visible.connection ? [visible.connection] : []),
                        online: true,
                    };
                });
                return sendJson(response, { devices, visibleDevices });
            }
            if (request.method === "GET" && pathname === "/api/readings") {
                return sendJson(response, {
                    readings: store.readingList({
                        deviceId: params.get("deviceId") || "",
                        from: params.get("from") || null,
                        limit: params.get("limit") || 500,
                        to: params.get("to") || null,
                    }),
                });
            }
            if (request.method === "GET" && pathname === "/api/events") {
                response.writeHead(200, {
                    "Access-Control-Allow-Origin": "*",
                    "Cache-Control": "no-cache",
                    Connection: "keep-alive",
                    "Content-Type": "text/event-stream; charset=utf-8",
                });
                response.write(": connected\n\n");
                monitor.subscribe(response);
                const timer = setInterval(() => response.write(": keep-alive\n\n"), 15_000);
                response.on("close", () => clearInterval(timer));
                return;
            }
            if (request.method === "POST" && pathname === "/api/collect") {
                await collectBody(request);
                const rows = await monitor.collectOnce();
                return sendJson(response, { ok: true, readings: rows });
            }
            if (request.method === "POST" && pathname === "/api/discover") {
                await collectBody(request);
                const devices = await monitor.discoverOnce();
                return sendJson(response, {
                    devices: devices.map(device => ({ ...device, id: deviceId(device) })),
                    ok: true,
                });
            }

            if (request.method === "GET" || request.method === "HEAD") return serveStatic(request, response, pathname);
            response.writeHead(404);
            response.end("Not found");
        } catch (error) {
            sendJson(response, { error: error.message || String(error) }, 500);
        }
    });

const parseArgs = argv => {
    const args = {
        collectInterval: 300,
        command: "server",
        demoData: false,
        discoverInterval: 60,
        host: "127.0.0.1",
        mode: "auto",
        open: true,
        port: 8765,
        raw: false,
        timeout: 15,
        udid: "",
    };
    const tokens = [...argv];
    if (tokens[0] && !tokens[0].startsWith("-")) args.command = tokens.shift();
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        const next = () => tokens[++index];
        if (token === "--mode") args.mode = next();
        else if (token === "--usb") args.mode = "usb";
        else if (token === "--network" || token === "-n") args.mode = "network";
        else if (token === "--host") args.host = next();
        else if (token === "--port") args.port = Number(next());
        else if (token === "--collect-interval") args.collectInterval = Number(next());
        else if (token === "--discover-interval") args.discoverInterval = Number(next());
        else if (token === "--timeout") args.timeout = Number(next());
        else if (token === "--no-open") args.open = false;
        else if (token === "--demo-data") args.demoData = true;
        else if (token === "--raw") args.raw = true;
        else if (token === "--udid" || token === "-u") args.udid = next();
        else if (token === "--help" || token === "-h") args.command = "help";
    }
    return args;
};

const printHelp = () => {
    console.log(`iOS Battery Monitor

Usage:
  node main.js server [--mode auto|usb|network] [--port 8765]
  node main.js discover [--mode auto|usb|network]
  node main.js once [--mode auto|usb|network] [--udid UDID] [--raw]

Options:
  --collect-interval N    Collection interval in seconds. Default: 300
  --discover-interval N   Discovery interval in seconds. Default: 60
  --timeout N             Command timeout in seconds. Default: 15
  --demo-data             Include an isolated 90-day demo device dataset.
`);
};

const printPretty = row => {
    const columns = [
        "Timestamp",
        "DeviceName",
        "Connection",
        "NominalChargeCapacity",
        "FullChargeCapacity",
        "DesignCapacity",
        "CycleCount",
        "QmaxCell0",
        "StateOfCharge",
        "IsCharging",
        "ExternalConnected",
        "Voltage",
        "Amperage",
        "Temperature",
    ];
    const width = Math.max(...columns.map(column => column.length));
    console.log("iOS Battery Info");
    console.log("-".repeat(48));
    for (const column of columns) console.log(`${column.padEnd(width)}  ${row[column] ?? ""}`);
};

const runDiscover = async args => {
    const devices = await discoverDevices(args.mode);
    if (!devices.length) {
        console.log("(no devices found)");
        return;
    }
    for (const device of devices) {
        console.log(
            `${device.udid} (${connectionLabel(device)})  ${deviceDisplayName(device)}  iOS/iPadOS ${device.product_version || "-"}`
        );
    }
};

const runOnce = async args => {
    const device = args.udid
        ? {
              build_version: "",
              connection: args.mode === "network" ? "network" : "usb",
              label: "",
              product_type: "",
              product_version: "",
              udid: args.udid,
          }
        : null;
    const result = await readBattery(device, args.mode, args.timeout * 1000);
    let actualDevice = result.device || device;
    if (actualDevice) actualDevice = await enrichDevice(actualDevice);
    const row = rowFromData(result.data, actualDevice, result.source);
    printPretty(row);
    console.log(`\nsource: ${result.source}`);
    if (args.raw) console.log(`\n--- raw ---\n${result.raw}`);
};

const runServer = async args => {
    const store = new BatteryStore({ demoData: args.demoData });
    const monitor = new MonitorService(store, {
        collectionInterval: args.collectInterval,
        discoveryInterval: args.discoverInterval,
        mode: args.mode,
        timeout: args.timeout * 1000,
    });
    const server = createServer(monitor, store);
    monitor.start();

    server.listen(args.port, args.host, () => {
        const url = `http://${args.host}:${args.port}`;
        console.log(`iOS Battery Monitor is running at ${url}`);
        console.log(`Collect interval: ${args.collectInterval}s; discovery interval: ${args.discoverInterval}s`);
        console.log(`Battery log: ${BATTERY_LOG_PATH}`);
        if (args.demoData) console.log("Demo data: enabled (not written to data files)");
        console.log("Press Ctrl+C to stop.");
        if (args.open) {
            const opener = os.platform() === "darwin" ? "open" : os.platform() === "win32" ? "cmd" : "xdg-open";
            const openerArgs = os.platform() === "win32" ? ["/c", "start", "", url] : [url];
            runCommand([opener, ...openerArgs], 5_000);
        }
    });

    const shutdown = () => {
        monitor.stop();
        server.close(() => process.exit(0));
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
};

const main = async () => {
    const args = parseArgs(process.argv.slice(2));
    if (args.command === "help") return printHelp();
    if (args.command === "discover") return runDiscover(args);
    if (args.command === "once") return runOnce(args);
    if (args.command === "server") return runServer(args);
    throw new Error(`Unknown command: ${args.command}`);
};

main().catch(error => {
    console.error(error.message || String(error));
    process.exit(1);
});
