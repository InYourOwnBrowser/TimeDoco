import re

with open('src/components/TimecodeSelector.tsx', 'r') as f:
    content = f.read()

# Add entries to destructured variables
content = content.replace(
    "const { timecodes, groups, addTimecode } = useTimeTracker();",
    "const { timecodes, groups, addTimecode, entries } = useTimeTracker();"
)

# Calculate most recent
recent_code = """
  const recentTimecodes = useMemo(() => {
    if (search) return [];

    const unarchived = timecodes.filter(t => !t.archived);
    const sortedEntries = [...entries].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
    const recentIds = Array.from(new Set(sortedEntries.map(e => e.timecodeId)));

    return recentIds
      .map(id => unarchived.find(t => t.id === id))
      .filter((t): t is typeof timecodes[0] => t !== undefined)
      .slice(0, 3);
  }, [entries, timecodes, search]);
"""

content = content.replace(
    "  const exactMatch = filteredTimecodes.find(t => t.name.toLowerCase() === search.toLowerCase());",
    recent_code + "\n  const exactMatch = filteredTimecodes.find(t => t.name.toLowerCase() === search.toLowerCase());"
)

# Fix the empty state bug (Bug 1.7)
content = content.replace(
    "{!timecodes.length && !search && (",
    "{filteredTimecodes.length === 0 && !search && ("
)

# Add recent timecodes to UI
recent_ui = """
              {recentTimecodes.length > 0 && (
                <div className="py-1 border-b border-gray-100 dark:border-gray-700/50">
                  <div className="px-3 py-1 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                    Recently Used
                  </div>
                  {recentTimecodes.map(tc => {
                    const group = groups.find(g => g.id === tc.groupId);
                    const color = tc.color || group?.color || '#9ca3af';
                    return (
                      <button
                        key={`recent-${tc.id}`}
                        onClick={() => handleSelect(tc.id)}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center justify-between group-hover:bg-gray-50 dark:group-hover:bg-gray-800"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }}></div>
                          <span>{tc.name}</span>
                          {group && <span className="text-xs text-gray-400 dark:text-gray-500 ml-1">in {group.name}</span>}
                        </div>
                        {selectedId === tc.id && <Check size={16} className="text-blue-500" />}
                      </button>
                    );
                  })}
                </div>
              )}
"""

content = content.replace(
    "              {Array.from(groupedTimecodes.entries()).map(([gId, tcs]) => {",
    recent_ui + "              {Array.from(groupedTimecodes.entries()).map(([gId, tcs]) => {"
)

with open('src/components/TimecodeSelector.tsx', 'w') as f:
    f.write(content)
