import { describe, it, expect, vi, beforeEach } from "vitest";

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
    const mockGroup = { id: "g1", name: "Fallback Group", color: "#3b82f6", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    await putGroup(mockGroup);
    const fallbackGroups = await getGroups();
    expect(fallbackGroups).toEqual([mockGroup]);
  });
});
