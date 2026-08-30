const fs = require('fs');
const file = 'src/components/GroupingManagement.tsx';
let content = fs.readFileSync(file, 'utf8');

// handleEditGroupSave
content = content.replace(
  /await updateGroup\(id, \{ name: trimmedName, color: editingGroupData\.color \}\);\s*setEditingGroupId\(null\);/,
  `if (await updateGroup(id, { name: trimmedName, color: editingGroupData.color })) {
      setEditingGroupId(null);
    }`
);

// handleEditTimecodeSave
content = content.replace(
  /await updateTimecode\(id, \{\s*name: trimmedName,\s*color: editingTimecodeData\.color \|\| undefined,\s*groupId: targetGroupId,\s*hourlyRate: isNaN\(parsedRate\) \|\| parsedRate <= 0 \? null : parsedRate,\s*\}\);\s*setEditingTimecodeId\(null\);/,
  `if (await updateTimecode(id, {
      name: trimmedName,
      color: editingTimecodeData.color || undefined,
      groupId: targetGroupId,
      hourlyRate: isNaN(parsedRate) || parsedRate <= 0 ? null : parsedRate,
    })) {
      setEditingTimecodeId(null);
    }`
);

// Archive group button
content = content.replace(
  /onClick=\{\(\) => updateGroup\(group\.id, \{ archived: true \}\)\}/,
  `onClick={async () => await updateGroup(group.id, { archived: true })}`
);

// Archive group mobile button
content = content.replace(
  /onClick=\{\(\) => \{\s*updateGroup\(group\.id, \{ archived: true \}\);\s*setMobileMenuId\(null\);\s*\}\}/,
  `onClick={async () => {
                          if (await updateGroup(group.id, { archived: true })) {
                            setMobileMenuId(null);
                          }
                        }}`
);

// Archive group mobile button (already covered or needs fine-tuning?)
content = content.replace(
  /updateGroup\(group\.id, \{ archived: true \}\);\s*setMobileMenuId\(null\);/,
  `if (await updateGroup(group.id, { archived: true })) {\n                            setMobileMenuId(null);\n                          }`
);

// Unarchive group
content = content.replace(
  /onClick=\{\(\) => updateGroup\(group\.id, \{ archived: false \}\)\}/,
  `onClick={async () => await updateGroup(group.id, { archived: false })}`
);

// Archive timecode
content = content.replace(
  /onClick=\{\(\) => updateTimecode\(tc\.id, \{ archived: !tc\.archived \}\)\}/,
  `onClick={async () => await updateTimecode(tc.id, { archived: !tc.archived })}`
);

// Archive timecode mobile
content = content.replace(
  /updateTimecode\(tc\.id, \{ archived: !tc\.archived \}\);\s*setMobileMenuId\(null\);/,
  `if (await updateTimecode(tc.id, { archived: !tc.archived })) {\n                        setMobileMenuId(null);\n                      }`
);

// Delete timecode mobile
content = content.replace(
  /deleteTimecode\(tc\.id\);\s*setMobileMenuId\(null\);/,
  `deleteTimecode(tc.id);\n                        setMobileMenuId(null);` // deleteTimecode returns void in context? wait, let's check
);

fs.writeFileSync(file, content);
