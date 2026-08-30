const fs = require('fs');

let file = 'src/utils/timeUtils.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /export const findFreeSlot = \([\s\S]*?\): \{ start: Date; end: Date \} => \{/,
  `export const findFreeSlot = (
  day: Date,
  deltaSeconds: number,
  entries: Entry[],
  excludeId?: string,
  timecodeId?: string,
  allowConcurrentTimers?: boolean
): { start: Date; end: Date } | null => {`
);

content = content.replace(
  /for \(const candMs of candidates\) \{\n\s*const candStart = new Date\(candMs\);\n\s*const candEnd = new Date\(candMs \+ deltaSeconds \* 1000\);\n\s*if \(\!checkOverlap\(candStart, candEnd, entries, excludeId, timecodeId, allowConcurrentTimers\)\) \{\n\s*return \{ start: candStart, end: candEnd \};\n\s*\}\n\s*\}/,
  `const dEndMs = new Date(day);
  dEndMs.setHours(23, 59, 59, 999);

  for (const candMs of candidates) {
    const candStart = new Date(candMs);
    const candEnd = new Date(candMs + deltaSeconds * 1000);
    if (candEnd.getTime() > dEndMs.getTime()) continue;

    if (!checkOverlap(candStart, candEnd, entries, excludeId, timecodeId, allowConcurrentTimers)) {
      return { start: candStart, end: candEnd };
    }
  }`
);

content = content.replace(
  /return \{ start: initialStart, end: initialEnd \};\n\};/,
  `return null;\n};`
);

fs.writeFileSync(file, content);
