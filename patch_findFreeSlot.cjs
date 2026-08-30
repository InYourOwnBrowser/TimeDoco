const fs = require('fs');

let file = 'src/utils/timeUtils.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /for \(const candMs of candidates\) \{\n\s*const candEnd = new Date\(candMs \+ deltaSeconds \* 1000\);\n\s*if \(\n\s*\!checkOverlap\(\n\s*new Date\(candMs\),\n\s*candEnd,\n\s*entries,\n\s*excludeId,\n\s*timecodeId,\n\s*allowConcurrentTimers\n\s*\)\n\s*\) \{\n\s*return \{ start: new Date\(candMs\), end: candEnd \};\n\s*\}\n\s*\}/,
  `const dEndMs = new Date(day);
  dEndMs.setHours(23, 59, 59, 999);

  for (const candMs of candidates) {
    const candEnd = new Date(candMs + deltaSeconds * 1000);
    if (candEnd.getTime() > dEndMs.getTime()) continue;

    if (
      !checkOverlap(
        new Date(candMs),
        candEnd,
        entries,
        excludeId,
        timecodeId,
        allowConcurrentTimers
      )
    ) {
      return { start: new Date(candMs), end: candEnd };
    }
  }`
);

// If the findFreeSlot does not find any, it should return null.
content = content.replace(
  /return \{ start: initialStart, end: initialEnd \};\n\s*\};/,
  `return null;\n};`
);
// wait actually, let's fix the return type first

fs.writeFileSync(file, content);
