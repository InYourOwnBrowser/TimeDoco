import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Add a state for showing the new timer form
content = content.replace(
    "const [activeTab, setActiveTab] = useState<'tracker' | 'analysis' | 'management'>('tracker');",
    "const [activeTab, setActiveTab] = useState<'tracker' | 'analysis' | 'management'>('tracker');\n  const [showNewTimer, setShowNewTimer] = useState(false);"
)

# Hide new timer form when appropriate
replace_str = """
              {activeEntries.map(entry => (
                <ActiveTimer key={entry.id} activeEntry={entry} />
              ))}
              {(activeEntries.length === 0 || showNewTimer) && (
                <ActiveTimer activeEntry={null} />
              )}
              {activeEntries.length > 0 && !showNewTimer && settings?.allowConcurrentTimers && (
                <button
                  onClick={() => setShowNewTimer(true)}
                  className="mb-8 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 rounded-lg transition-colors border border-blue-200 dark:border-blue-800"
                >
                  + Start Another Timer
                </button>
              )}
"""

content = re.sub(
    r"\{\s*activeEntries\.map\(entry => \(\s*<ActiveTimer key=\{entry\.id\} activeEntry=\{entry\} />\s*\)\)\s*\}\s*<ActiveTimer activeEntry=\{null\} />",
    replace_str.strip(),
    content
)

with open('src/App.tsx', 'w') as f:
    f.write(content)
