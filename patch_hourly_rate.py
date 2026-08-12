import re

with open('src/components/GroupingManagement.tsx', 'r') as f:
    content = f.read()

# Add hourlyRate to state
content = content.replace(
    "const [editingTimecodeData, setEditingTimecodeData] = useState<{ name: string; color: string; groupId: string }>({ name: '', color: '', groupId: '' });",
    "const [editingTimecodeData, setEditingTimecodeData] = useState<{ name: string; color: string; groupId: string; hourlyRate: string }>({ name: '', color: '', groupId: '', hourlyRate: '' });"
)

# Update state initialization in handleEditTimecodeStart
content = content.replace(
    """    setEditingTimecodeData({
      name: tc.name,
      color: tc.color || '',
      groupId: tc.groupId || '',
    });""",
    """    setEditingTimecodeData({
      name: tc.name,
      color: tc.color || '',
      groupId: tc.groupId || '',
      hourlyRate: tc.hourlyRate ? tc.hourlyRate.toString() : '',
    });"""
)

# Update save logic
content = content.replace(
    """    await updateTimecode(id, {
      name: editingTimecodeData.name,
      color: editingTimecodeData.color || undefined,
      groupId: editingTimecodeData.groupId || null,
    });""",
    """    const parsedRate = parseFloat(editingTimecodeData.hourlyRate);
    await updateTimecode(id, {
      name: editingTimecodeData.name,
      color: editingTimecodeData.color || undefined,
      groupId: editingTimecodeData.groupId || null,
      hourlyRate: isNaN(parsedRate) ? null : parsedRate,
    });"""
)

# Add UI for hourlyRate
ui_add = """                      <input
                        type="number"
                        placeholder="Rate (opt)"
                        value={editingTimecodeData.hourlyRate}
                        onChange={(e) => setEditingTimecodeData({ ...editingTimecodeData, hourlyRate: e.target.value })}
                        className="w-24 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        min="0"
                        step="0.01"
                      />
"""
content = content.replace(
    "                      </select>\n                      <button",
    "                      </select>\n" + ui_add + "                      <button"
)

with open('src/components/GroupingManagement.tsx', 'w') as f:
    f.write(content)
