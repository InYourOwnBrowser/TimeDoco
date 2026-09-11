import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Group } from "../types";

describe("db error fallback mode", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("importBackup rejects (does not silently succeed) on a corrupt payload", async () => {
    const { importBackup } = await import("./index");
    const corrupt = {
      schemaVersion: 1,
      groups: [{ name: "Bad Group" } as any],
      timecodes: [],
      entries: [],
      settings: undefined
    };

    await expect(importBackup(corrupt, "replace")).rejects.toThrow();
  });

  it("triggers fallback mode, dispatches idb-fallback-mode event, and returns fallback memory DB items when getDB throws in getGroups", async () => {
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const dbError = new Error("IndexedDB getGroups failure");

    // Mock idb openDB before importing index module
    vi.doMock("idb", async (importOriginal) => {
      const actual = await importOriginal<typeof import("idb")>();
      return {
        ...actual,
        openDB: vi.fn().mockRejectedValue(dbError),
      };
    });

    const { getGroups, putGroup } = await import("./index");

    // Call getGroups when DB fails
    const result = await getGroups();

    // Verify it returns array from fallback memory DB
    expect(Array.isArray(result)).toBe(true);

    // Verify idb-fallback-mode event was dispatched
    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "idb-fallback-mode",
        detail: { error: dbError }
      })
    );

    // Verify subsequent getGroups call hits fallback mode directly and returns items in fallbackMemoryDB
    const mockGroup: Group = { id: "g1", name: "Fallback Group", color: "#3b82f6", archived: false, updatedAt: "2026-01-01" };
    await putGroup(mockGroup);
    const fallbackGroups = await getGroups();
    expect(fallbackGroups).toEqual([mockGroup]);
  });

  it("does not enter fallback mode when a single operation fails", async () => {
    // A rejected put, an aborted transaction, one unreadable record: none of
    // these mean the database is unusable. Treating them as connection
    // failures emptied the app's whole view of its own data, which to the user
    // looks like total data loss.
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const stored: Group[] = [
      { id: "g1", name: "Real Group", color: "#3b82f6", archived: false, updatedAt: "2026-01-01" } as Group,
    ];

    vi.doMock("idb", async (importOriginal) => {
      const actual = await importOriginal<typeof import("idb")>();
      return {
        ...actual,
        openDB: vi.fn().mockResolvedValue({
          // The connection is healthy; this one write fails.
          put: vi.fn().mockRejectedValue(new Error("QuotaExceededError")),
          getAll: vi.fn().mockResolvedValue(stored),
          get: vi.fn(),
          delete: vi.fn(),
          close: vi.fn(),
        }),
      };
    });

    const { putGroup, getGroups } = await import("./index");

    await expect(
      putGroup({ id: "g2", name: "New", color: "#000", archived: false, updatedAt: "2026-01-02" } as Group)
    ).rejects.toThrow("QuotaExceededError");

    // No degradation was announced...
    expect(dispatchSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "idb-fallback-mode" })
    );
    // ...and the user's existing data is still there, not an empty memory store.
    expect(await getGroups()).toEqual(stored);
  });

  it("clears fallback mode on closeDB so a later reopen can succeed", async () => {
    vi.doMock("idb", async (importOriginal) => {
      const actual = await importOriginal<typeof import("idb")>();
      return { ...actual, openDB: vi.fn().mockRejectedValue(new Error("boom")) };
    });

    const { getGroups, putGroup, closeDB, getIsFallbackMode } = await import("./index");

    await getGroups(); // enters fallback mode
    await putGroup({ id: "gx", name: "Held in memory", color: "#000", archived: false, updatedAt: "2026-01-01" } as Group);
    expect(await getGroups()).toHaveLength(1);
    expect(getIsFallbackMode()).toBe(true);

    await closeDB();

    // Fallback state is reset with the connection rather than persisting for
    // the life of the page.
    expect(getIsFallbackMode()).toBe(false);
  });

  it("closeDB keeps the in-memory data, which in fallback mode is the only copy", async () => {
    vi.doMock("idb", async (importOriginal) => {
      const actual = await importOriginal<typeof import("idb")>();
      return { ...actual, openDB: vi.fn().mockRejectedValue(new Error("boom")) };
    });

    const { getGroups, putGroup, closeDB, resetDBForTests } = await import("./index");

    await getGroups(); // enters fallback mode
    await putGroup({ id: "gx", name: "Held in memory", color: "#000", archived: false, updatedAt: "2026-01-01" } as Group);

    await closeDB();

    // The reopen fails again, so the app is back in fallback mode — reading the
    // work the user did before, rather than an empty app.
    expect(await getGroups()).toHaveLength(1);

    // The wipe is its own function, for a test that wants a clean slate.
    await resetDBForTests();
    expect(await getGroups()).toHaveLength(0);
  });

  it("getActiveEntry returns the most recently started active timer", async () => {
    const entries = [
      { id: "late", isRunning: true, startTime: "2026-01-01T12:00:00.000Z" },
      { id: "early", isRunning: true, startTime: "2026-01-01T09:00:00.000Z" },
      { id: "stopped", isRunning: false, startTime: "2026-01-01T08:00:00.000Z" },
      { id: "trashed", isRunning: true, startTime: "2026-01-01T07:00:00.000Z", deletedAt: "2026-01-02" },
    ];

    vi.doMock("idb", async (importOriginal) => {
      const actual = await importOriginal<typeof import("idb")>();
      return {
        ...actual,
        openDB: vi.fn().mockResolvedValue({
          getAll: vi.fn().mockResolvedValue(entries),
          close: vi.fn(),
        }),
      };
    });

    const { getActiveEntry, getActiveEntries } = await import("./index");

    expect((await getActiveEntry())?.id).toBe("late");
    expect((await getActiveEntries()).map((e) => e.id)).toEqual(["late", "early"]);
  });

  it("sorts entries correctly by timestamp even with mixed timezone ISO offsets", async () => {
    // String sorting "2026-01-02T00:00:00+13:00" vs "2026-01-01T20:00:00Z" would fail,
    // because lexicographically "+13:00" string is greater than "Z", but chronologically
    // 2026-01-02T00:00:00+13:00 is 2026-01-01T11:00:00Z which is earlier than 2026-01-01T20:00:00Z.
    const entries = [
      { id: "later", startTime: "2026-01-01T20:00:00Z" },
      { id: "earlier", startTime: "2026-01-02T00:00:00+13:00" }, // 11:00 UTC on Jan 1
      { id: "latest", startTime: "2026-01-02T10:00:00Z" },
    ];

    vi.doMock("idb", async (importOriginal) => {
      const actual = await importOriginal<typeof import("idb")>();
      return {
        ...actual,
        openDB: vi.fn().mockResolvedValue({
          getAll: vi.fn().mockResolvedValue(entries),
          close: vi.fn(),
        }),
      };
    });

    const { getEntries } = await import("./index");
    const result = await getEntries();

    expect(result.map((e) => e.id)).toEqual(["earlier", "later", "latest"]);
  });
});
