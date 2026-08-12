import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# We want to reset showNewTimer when a new timer is actually started.
# We can do this with a useEffect on activeEntries.length.

use_effect_str = """
  // Reset new timer form when a timer starts or concurrent is disabled
  useEffect(() => {
    setShowNewTimer(false);
  }, [activeEntries.length, settings?.allowConcurrentTimers]);
"""

# Insert it before the root useEffect
content = content.replace(
    "  useEffect(() => {\n    const root = window.document.documentElement;",
    use_effect_str + "\n  useEffect(() => {\n    const root = window.document.documentElement;"
)

with open('src/App.tsx', 'w') as f:
    f.write(content)
