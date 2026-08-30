const fs = require('fs');
const file = 'src/components/SettingsModal.tsx';
let content = fs.readFileSync(file, 'utf8');

// In SettingsModal.tsx (Trash tab), check the result of await emptyTrash().
// Only show the success toast (setStatusMsg) if the function returns true.
content = content.replace(
  /await emptyTrash\(\);\s*setStatusMsg\(\{\s*type: 'success',\s*text: 'Trash emptied',\s*\}\);/,
  `if (await emptyTrash()) {
                            setStatusMsg({
                              type: 'success',
                              text: 'Trash emptied',
                            });
                          }`
);

fs.writeFileSync(file, content);
