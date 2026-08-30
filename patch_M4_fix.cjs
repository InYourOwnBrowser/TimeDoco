const fs = require('fs');

let file = 'src/context/TimeTrackerContext.tsx';
let content = fs.readFileSync(file, 'utf8');

// We need to move the overlap check in restoreTimecodeInternal to BEFORE the timecode is restored.
content = content.replace(
  /const restoreTimecodeInternal = async \(id: string, skipOverlapCheck = false\) => \{\n\s*const tc = await db\.getTimecode\(id\);\n\s*if \(tc\) \{\n\s*const deletedTime = tc\.deletedAt;\n\s*tc\.deletedAt = undefined;\n\s*await db\.putTimecode\(touch\(tc\)\);\n\s*if \(tc\.groupId\) \{\n\s*const group = await db\.getGroup\(tc\.groupId\);\n\s*if \(group && group\.deletedAt\) \{\n\s*await restoreGroupInternal\(group\.id\);\n\s*\}\n\s*\}\n\s*const allEntries = await db\.getEntries\(\);\n\s*const entriesToRestore = allEntries\.filter\(e => e\.timecodeId === id && e\.deletedAt === deletedTime\);\n\s*if \(\!skipOverlapCheck && entriesToRestore\.length > 0\) \{\n\s*const liveEntries = allEntries\.filter\(e => \!e\.deletedAt\);\n\s*const rejected = findOverlappingCandidates\(entriesToRestore, liveEntries, settings\?\.allowConcurrentTimers\);\n\s*if \(rejected\.size > 0\) \{\n\s*throw new Error\('Cannot restore timecode: entries overlap with existing live entries\.'\);\n\s*\}\n\s*\}/,
  `const restoreTimecodeInternal = async (id: string, skipOverlapCheck = false) => {
    const tc = await db.getTimecode(id);
    if (tc) {
      const deletedTime = tc.deletedAt;
      const allEntries = await db.getEntries();
      const entriesToRestore = allEntries.filter(e => e.timecodeId === id && e.deletedAt === deletedTime);

      if (!skipOverlapCheck && entriesToRestore.length > 0) {
        const liveEntries = allEntries.filter(e => !e.deletedAt);
        const rejected = findOverlappingCandidates(entriesToRestore, liveEntries, settings?.allowConcurrentTimers);
        if (rejected.size > 0) {
          throw new Error('Cannot restore timecode: entries overlap with existing live entries.');
        }
      }

      tc.deletedAt = undefined;
      await db.putTimecode(touch(tc));

      if (tc.groupId) {
        const group = await db.getGroup(tc.groupId);
        if (group && group.deletedAt) {
          await restoreGroupInternal(group.id);
        }
      }`
);

fs.writeFileSync(file, content);
