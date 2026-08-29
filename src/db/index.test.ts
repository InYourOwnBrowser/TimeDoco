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

    const { getGroups, putGroup, closeDB } = await import("./index");

    await getGroups(); // enters fallback mode
    await putGroup({ id: "gx", name: "Held in memory", color: "#000", archived: false, updatedAt: "2026-01-01" } as Group);
    expect(await getGroups()).toHaveLength(1);

    await closeDB();

    // Fallback state is reset with the connection rather than persisting for
    // the life of the page.
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

  it("falls back to a full scan when the start-time index would drop records", async () => {
    // A record with no startTime is absent from the index. Returning the index
    // result blindly would silently lose it from the user's entry list.
    const all = [
      { id: "a", startTime: "2026-01-02T09:00:00.000Z" },
      { id: "b", startTime: "2026-01-01T09:00:00.000Z" },
      { id: "orphan" },
    ];

    vi.doMock("idb", async (importOriginal) => {
      const actual = await importOriginal<typeof import("idb")>();
      return {
        ...actual,
        openDB: vi.fn().mockResolvedValue({
          getAllFromIndex: vi.fn().mockResolvedValue([all[1], all[0]]),
          count: vi.fn().mockResolvedValue(3),
          getAll: vi.fn().mockResolvedValue(all),
          close: vi.fn(),
        }),
      };
    });

    const { getEntries } = await import("./index");
    const result = await getEntries();

    expect(result).toHaveLength(3);
    expect(result.map((e) => e.id)).toContain("orphan");
  });
});
