const fs = require('fs');
const file = 'src/components/TimesheetMatrixView.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /const \{ start, end \} = findFreeSlot\(/g,
  `const slot = findFreeSlot(`
);

content = content.replace(
  /\s*settings\?\.allowConcurrentTimers\n\s*\);\n\n\s*if \(existingAdjustment\) \{/g,
  `\n      settings?.allowConcurrentTimers\n    );\n\n    if (!slot) {\n      addToast('No free time left on this day — edit the underlying entries instead.', 'error');\n      return;\n    }\n    const { start, end } = slot;\n\n    if (existingAdjustment) {`
);

fs.writeFileSync(file, content);
