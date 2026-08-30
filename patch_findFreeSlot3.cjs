const fs = require('fs');

let file = 'src/utils/timeUtils.ts';
let content = fs.readFileSync(file, 'utf8');

// The file still had a fallback return that didn't return null.
content = content.replace(
  /const maxEndMs = Math\.max\([\s\S]*?\);\n\s*const fallbackStart = new Date\(maxEndMs\);\n\s*const fallbackEnd = new Date\(maxEndMs \+ deltaSeconds \* 1000\);\n\s*return \{ start: fallbackStart, end: fallbackEnd \};\n\};/,
  `return null;\n};`
);

fs.writeFileSync(file, content);
