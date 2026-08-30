const fs = require('fs');
const file = 'src/components/SettingsModal.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /await emptyTrash\(\);\s*setStatusMsg\(\{ type: 'success', text: 'Trash emptied successfully\.' \}\);/,
  `if (await emptyTrash()) {
                            setStatusMsg({ type: 'success', text: 'Trash emptied successfully.' });
                          }`
);

fs.writeFileSync(file, content);
