const fs = require('fs');

let file = 'src/tests/TimeTotals.consistency.test.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /import \{ toWindow \} from '\.\.\/utils\/timeUtils';/,
  `import { startOfDay, endOfDay } from 'date-fns';`
);

content = content.replace(
  /const window = toWindow\(day, 'day'\);/g,
  `const window = { start: startOfDay(day), end: endOfDay(day) };`
);

content = content.replace(
  /return Array\.from\(buildReportLines\(entries, \[\], \[\], window, settings\)\.values\(\)\)\.reduce\(\(acc, line\) => acc \+ line\.hours \* 3600, 0\);/g,
  `return Array.from(buildReportLines(entries, settings, window, { now: day }).values()).reduce((acc, line) => acc + line.hours * 3600, 0);`
);

fs.writeFileSync(file, content);

// And we need to fix timeUtils.test.ts where slot is null.
file = 'src/utils/timeUtils.test.ts';
content = fs.readFileSync(file, 'utf8');
content = content.replace(
  /const slot = findFreeSlot\(day, 3600, \[\]\);/g,
  `const slot = findFreeSlot(day, 3600, [])!;`
);
content = content.replace(
  /const slot = findFreeSlot\(day, 3600, \[\]\);\n\s*expect\(slot\.start\.toISOString\(\)\)\.toBe\(dayStart\);\n\s*expect\(slot\.end\.toISOString\(\)\)\.toBe\(dayEnd\);/g,
  `const slot = findFreeSlot(day, 3600, [])!;\n    expect(slot.start.toISOString()).toBe(dayStart);\n    expect(slot.end.toISOString()).toBe(dayEnd);`
);
content = content.replace(
  /const slot = findFreeSlot\(day, 7200, entries\);/g,
  `const slot = findFreeSlot(day, 7200, entries)!;`
);
content = content.replace(
  /const slot = findFreeSlot\(day, 3600, entries, '1'\);/g,
  `const slot = findFreeSlot(day, 3600, entries, '1')!;`
);
content = content.replace(
  /const slot = findFreeSlot\(day, 3600, entries, undefined, 'tc1', true\);/g,
  `const slot = findFreeSlot(day, 3600, entries, undefined, 'tc1', true)!;`
);
content = content.replace(
  /const slot = findFreeSlot\(day, 3600, entries, undefined, 'tc2', true\);/g,
  `const slot = findFreeSlot(day, 3600, entries, undefined, 'tc2', true)!;`
);
fs.writeFileSync(file, content);
