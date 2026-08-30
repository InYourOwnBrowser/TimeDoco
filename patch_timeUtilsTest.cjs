const fs = require('fs');

let file = 'src/utils/timeUtils.test.ts';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /const slot = findFreeSlot\(day, 1800, entries, undefined, 'tc1', false\);/g,
  `const slot = findFreeSlot(day, 1800, entries, undefined, 'tc1', false)!;`
);

fs.writeFileSync(file, content);
