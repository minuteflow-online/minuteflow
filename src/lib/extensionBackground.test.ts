import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * The extension's background service worker, run in a sandbox with a fake
 * `chrome` and a fake database.
 *
 * Chrome puts the worker to sleep and wakes it with a blank memory. These tests
 * start a fresh worker each time, the way a wake-up does, and check that the
 * 5-minute capture still happens and the countdown is not reset:
 *  - the alarm that wakes the worker must not be read as "clocked out"
 *  - an alarm that is already running must be left alone
 *  - a task that was already running must not be treated as newly started
 */

const SOURCE = fs.readFileSync(path.join(process.cwd(), "extension", "background.js"), "utf8");

type Row = Record<string, unknown>;

function boot(opts: {
  serverSession?: Row | null; // what the sessions table says; null = lookup fails
  storage?: Record<string, unknown>;
  existingAlarms?: string[];
}) {
  const alarmsCreated: string[] = [];
  const alarmsLive = new Set(opts.existingAlarms ?? []);
  const storage: Record<string, unknown> = { ...(opts.storage ?? {}) };
  const markers: string[] = [];
  const queries: string[] = [];

  const chrome = {
    alarms: {
      create: (name: string) => {
        alarmsCreated.push(name);
        alarmsLive.add(name);
      },
      get: async (name: string) => (alarmsLive.has(name) ? { name } : undefined),
      clear: async (name: string) => alarmsLive.delete(name),
      onAlarm: { addListener: () => {} },
    },
    runtime: { onMessage: { addListener: () => {} }, onInstalled: { addListener: () => {} }, getManifest: () => ({ version: "test" }) },
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((k) => k in storage).map((k) => [k, storage[k]]));
        },
        set: async (obj: Record<string, unknown>) => void Object.assign(storage, obj),
        remove: async (key: string) => void delete storage[key],
      },
    },
    // "idle" makes a capture slot record a marker, which is the cheapest
    // observable proof that the slot ran and did not return silently.
    idle: { queryState: async () => "idle" },
    tabs: {},
    windows: {},
    notifications: { create: () => {} },
  };

  const db = {
    getSession: async () => ({ user: { id: "u1", email: "a@b.c" } }),
    ensureAuth: async () => null, // initialize() stays inert: no polling starts
    getAuthHeaders: async () => ({}),
    query: async (table: string, o: { filters: string }) => {
      queries.push(`${table}?${o.filters}`);
      if (table !== "sessions") return [];
      if (opts.serverSession === null) throw new Error("offline");
      return [opts.serverSession ?? { clocked_in: true, active_task: null }];
    },
  };

  const context: Record<string, unknown> = {
    chrome,
    importScripts: () => {},
    console: { log() {}, warn() {}, error() {} },
    setInterval: () => 0,
    clearInterval: () => {},
    setTimeout,
    fetch: async (_url: string, init?: { body?: string }) => {
      try {
        const body = JSON.parse(init?.body ?? "{}");
        if (body.failureReason) markers.push(body.failureReason);
      } catch {
        /* not a marker request */
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
    },
    // Class/constructor globals the worker may touch.
    URL,
    Date,
    Math,
    JSON,
    Promise,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Error,
    Uint8Array,
    btoa,
    atob,
    OffscreenCanvas: undefined,
    Blob,
    FormData,
  };
  context.globalThis = context;
  (context as { MinuteFlowDB?: unknown }).MinuteFlowDB = db;
  vm.createContext(context);
  vm.runInContext(SOURCE, context);

  return { context, alarmsCreated, alarmsLive, storage, markers, queries };
}

const call = (ctx: Record<string, unknown>, fn: string, ...args: unknown[]) =>
  (ctx[fn] as (...a: unknown[]) => Promise<unknown>)(...args);

describe("extension background worker after Chrome wakes it with blank memory", () => {
  it("still runs the 5-minute slot when the server says the person is clocked in", async () => {
    const { context, markers } = boot({ serverSession: { clocked_in: true, active_task: null } });
    // Blank memory: the worker has not seen a poll yet, so isClockedIn is false.
    await call(context, "runScheduledCapture");
    // The slot did something (here: recorded why there is no screenshot) instead of returning silently.
    expect(markers.length).toBe(1);
  });

  it("skips the slot when the server says the person is clocked out", async () => {
    const { context, markers } = boot({ serverSession: { clocked_in: false, active_task: null } });
    await call(context, "runScheduledCapture");
    expect(markers).toEqual([]);
  });

  it("uses the saved flag when the server cannot be reached, and skips when there is none", async () => {
    const withFlag = boot({ serverSession: null, storage: { mf_clocked_in: true } });
    await call(withFlag.context, "runScheduledCapture");
    expect(withFlag.markers.length).toBe(1);

    const withoutFlag = boot({ serverSession: null });
    await call(withoutFlag.context, "runScheduledCapture");
    expect(withoutFlag.markers).toEqual([]);
  });

  it("leaves a running capture alarm alone instead of resetting its countdown", async () => {
    const { context, alarmsCreated } = boot({ existingAlarms: ["minuteflow-capture"] });
    await call(context, "startCaptureSchedule");
    expect(alarmsCreated.filter((n) => n === "minuteflow-capture")).toEqual([]);
  });

  it("creates the capture alarm when there is none", async () => {
    const { context, alarmsCreated } = boot({});
    await call(context, "startCaptureSchedule");
    await call(context, "startCaptureSchedule"); // the second call must not make another
    expect(alarmsCreated.filter((n) => n === "minuteflow-capture")).toHaveLength(1);
  });

  it("does not treat a task the server still shows as running as newly started after a restart", async () => {
    const { context, alarmsCreated } = boot({
      serverSession: { clocked_in: true, active_task: { logId: 77 } },
      storage: { mf_active_log_id: 77 },
      existingAlarms: ["minuteflow-capture"],
    });
    const captures: unknown[][] = [];
    context.captureLocalThenUpload = async (...args: unknown[]) => void captures.push(args);
    // The state initialize() restores on a wake-up. These are top-level `let`s
    // in the worker, so they are set from inside the sandbox.
    vm.runInContext("currentTaskLogId = 77", context as vm.Context);
    await call(context, "runSessionCheck");
    expect(captures).toEqual([]); // no bogus "start" screenshot
    expect(alarmsCreated.filter((n) => n === "minuteflow-capture")).toEqual([]); // countdown untouched
    expect(vm.runInContext("lastActiveTaskId", context as vm.Context)).toBe(77);
  });

  it("still treats a genuinely different task as a new start", async () => {
    const { context } = boot({
      serverSession: { clocked_in: true, active_task: { logId: 78 } },
      storage: { mf_active_log_id: 77 },
      existingAlarms: ["minuteflow-capture"],
    });
    const captures: unknown[][] = [];
    context.captureLocalThenUpload = async (...args: unknown[]) => void captures.push(args);
    vm.runInContext("currentTaskLogId = 77", context as vm.Context);
    await call(context, "runSessionCheck");
    expect(captures.some((a) => a[0] === "start" && a[1] === 78)).toBe(true);
    expect(vm.runInContext("lastActiveTaskId", context as vm.Context)).toBe(78);
  });
});
