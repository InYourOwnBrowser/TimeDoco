import { describe, it, expect } from 'vitest';
import { importBackup } from './index';

describe('importBackup', () => {
  it('rejects (does not silently succeed) on a corrupt payload', async () => {
    // A corrupt group missing required fields like `id` which would violate the TS types
    // but can happen at runtime if a user uploads a bad JSON file.
    // By forcibly casting it to any we test the runtime protection of IDB transaction.
    const corrupt = {
      schemaVersion: 1,
      groups: [{ name: 'Bad Group' } as any],
      timecodes: [],
      entries: [],
      settings: undefined
    };

    await expect(importBackup(corrupt, 'replace')).rejects.toThrow();
  });
});
