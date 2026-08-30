const fs = require('fs');

let file = 'src/tests/TimeTotals.consistency.test.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /import \{ Entry, Settings \} from '\.\.\/types';/,
  `import type { Entry, Settings } from '../types';`
);

content = content.replace(
  /return buildScreenLines\(entries, settings, day\)\.reduce\(\(acc, line\) => acc \+ line\.hours \* 3600, 0\);/g,
  `return Array.from(buildScreenLines(entries, settings, { now: day }).values()).reduce((acc, line) => acc + line.hours * 3600, 0);`
);

content = content.replace(
  /return buildReportLines\(entries, \[\], \[\], window, settings\)\.reduce\(\(acc, line\) => acc \+ line\.hours \* 3600, 0\);/,
  `return Array.from(buildReportLines(entries, [], [], window, settings).values()).reduce((acc, line) => acc + line.hours * 3600, 0);`
);

fs.writeFileSync(file, content);
