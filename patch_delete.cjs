const fs = require('fs');
const file = 'src/components/GroupingManagement.tsx';
let content = fs.readFileSync(file, 'utf8');

// fix deleteGroup calls to be async
content = content.replace(
  /deleteGroup\(group\.id\);/g,
  `await deleteGroup(group.id);`
);

content = content.replace(
  /deleteTimecode\(tc\.id\);/g,
  `await deleteTimecode(tc.id);`
);

fs.writeFileSync(file, content);
