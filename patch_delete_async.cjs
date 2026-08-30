const fs = require('fs');
const file = 'src/components/GroupingManagement.tsx';
let content = fs.readFileSync(file, 'utf8');

// For line 477, 523, 822:
content = content.replace(
  /onClick=\{\(\) => \{\s*if \(\s*window\.confirm\(\s*`Are you sure you want to delete the group "\$\{group\.name\}"\?\`\s*\)\s*\) \{\s*await deleteGroup\(group\.id\);\s*\}\s*\}\}/g,
  `onClick={async () => {
                      if (
                        window.confirm(
                          \`Are you sure you want to delete the group "\${group.name}"?\`
                        )
                      ) {
                        await deleteGroup(group.id);
                      }
                    }}`
);
// For line 1016
content = content.replace(
  /onClick=\{\(\) => \{\s*if \(\s*window\.confirm\(\s*`Are you sure you want to delete the timecode "\$\{tc\.name\}"\?` \+\s*` Any deleted entries will be removed from the toast or Trash\.`\s*\)\s*\) \{\s*await deleteTimecode\(tc\.id\);\s*\}\s*\}\}/g,
  `onClick={async () => {
                    if (
                      window.confirm(
                        \`Are you sure you want to delete the timecode "\${tc.name}"? Any deleted entries will be removed from the toast or Trash.\`
                      )
                    ) {
                      await deleteTimecode(tc.id);
                    }
                  }}`
);
// For line 1057 (Archive timecode mobile)
content = content.replace(
  /onClick=\{\(\) => \{\s*if \(await updateTimecode\(tc\.id, \{ archived: !tc\.archived \}\)\) \{\n                        setMobileMenuId\(null\);\n                      \}\s*\}\}/g,
  `onClick={async () => {
                        if (await updateTimecode(tc.id, { archived: !tc.archived })) {
                          setMobileMenuId(null);
                        }
                      }}`
);
// For line 1072
content = content.replace(
  /onClick=\{\(\) => \{\s*if \(\s*window\.confirm\(\s*`Are you sure you want to delete the timecode "\$\{tc\.name\}"\? Any deleted entries will be removed from the toast or Trash\.`\s*\)\s*\) \{\s*await deleteTimecode\(tc\.id\);\n                        setMobileMenuId\(null\);\s*\}\s*\}\}/g,
  `onClick={async () => {
                        if (
                          window.confirm(
                            \`Are you sure you want to delete the timecode "\${tc.name}"? Any deleted entries will be removed from the toast or Trash.\`
                          )
                        ) {
                          await deleteTimecode(tc.id);
                          setMobileMenuId(null);
                        }
                      }}`
);

fs.writeFileSync(file, content);
