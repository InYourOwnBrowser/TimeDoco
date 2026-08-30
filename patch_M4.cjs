const fs = require('fs');

let file = 'src/context/TimeTrackerContext.tsx';
let content = fs.readFileSync(file, 'utf8');

// M-4: Trash Overlap
// restoreEntryInternal
content = content.replace(
  /const restoreEntryInternal = async \(id: string\) => \{/,
  `const restoreEntryInternal = async (id: string, skipOverlapCheck = false) => {`
);

content = content.replace(
  /const entry = await db\.getEntry\(id\);\n\s*if \(entry\) \{\n\s*entry\.deletedAt = undefined;/,
  `const entry = await db.getEntry(id);
    if (entry) {
      if (!skipOverlapCheck) {
        const liveEntries = await db.getEntries().then(res => res.filter(e => !e.deletedAt));
        const rejected = findOverlappingCandidates([entry], liveEntries, settings?.allowConcurrentTimers);
        if (rejected.size > 0) {
          throw new Error('Cannot restore entry: overlaps with existing live entries.');
        }
      }
      entry.deletedAt = undefined;`
);

// restoreTimecodeInternal
content = content.replace(
  /const restoreTimecodeInternal = async \(id: string\) => \{/,
  `const restoreTimecodeInternal = async (id: string, skipOverlapCheck = false) => {`
);

content = content.replace(
  /const allEntries = await db\.getEntries\(\);\n\s*const entriesToRestore = allEntries\.filter\(e => e\.timecodeId === id && e\.deletedAt === deletedTime\);\n\s*for \(const entry of entriesToRestore\) \{\n\s*await restoreEntryInternal\(entry\.id\);\n\s*\}/,
  `const allEntries = await db.getEntries();
      const entriesToRestore = allEntries.filter(e => e.timecodeId === id && e.deletedAt === deletedTime);

      if (!skipOverlapCheck && entriesToRestore.length > 0) {
        const liveEntries = allEntries.filter(e => !e.deletedAt);
        const rejected = findOverlappingCandidates(entriesToRestore, liveEntries, settings?.allowConcurrentTimers);
        if (rejected.size > 0) {
          throw new Error('Cannot restore timecode: entries overlap with existing live entries.');
        }
      }

      for (const entry of entriesToRestore) {
        await restoreEntryInternal(entry.id, true);
      }`
);

// restoreEntry Wrapper
content = content.replace(
  /const restoreEntry = async \(id: string\) => \{\n\s*await restoreEntryInternal\(id\);\n\s*await refreshData\(\);\n\s*\};/,
  `const restoreEntry = async (id: string) => {
    try {
      await restoreEntryInternal(id);
      await refreshData();
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to restore entry', 'error');
    }
  };`
);

// restoreTimecode Wrapper
content = content.replace(
  /const restoreTimecode = async \(id: string\) => \{\n\s*await restoreTimecodeInternal\(id\);\n\s*await refreshData\(\);\n\s*\};/,
  `const restoreTimecode = async (id: string) => {
    try {
      await restoreTimecodeInternal(id);
      await refreshData();
    } catch (error) {
      addToast(error instanceof Error ? error.message : 'Failed to restore timecode', 'error');
    }
  };`
);

fs.writeFileSync(file, content);
