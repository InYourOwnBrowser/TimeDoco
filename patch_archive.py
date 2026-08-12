import re

with open('src/components/GroupingManagement.tsx', 'r') as f:
    content = f.read()

# For Group
group_pattern = r"onClick=\{\(\) => updateGroup\(group\.id, \{ archived: !group\.archived \}\)\}"
group_replace = r"""onClick={() => {
                          if (group.archived || window.confirm('Are you sure you want to archive this group? It will be hidden from selection.')) {
                            updateGroup(group.id, { archived: !group.archived });
                          }
                        }}"""
content = re.sub(group_pattern, group_replace, content)

# For Timecode
tc_pattern = r"onClick=\{\(\) => updateTimecode\(tc\.id, \{ archived: !tc\.archived \}\)\}"
tc_replace = r"""onClick={() => {
                            if (tc.archived || window.confirm('Are you sure you want to archive this timecode? It will be hidden from selection.')) {
                              updateTimecode(tc.id, { archived: !tc.archived });
                            }
                          }}"""
content = re.sub(tc_pattern, tc_replace, content)

with open('src/components/GroupingManagement.tsx', 'w') as f:
    f.write(content)
