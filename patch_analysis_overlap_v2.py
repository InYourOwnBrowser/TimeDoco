import re

with open('src/components/AnalysisView.tsx', 'r') as f:
    content = f.read()

# Add overlap detection
overlap_logic = """
  // Detect overlaps in the filtered entries
  const overlaps = useMemo(() => {
    const overlappingPairs: { e1: typeof entries[0], e2: typeof entries[0] }[] = [];
    const sorted = [...filteredEntries].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const e1 = sorted[i];
        const e2 = sorted[j];

        const start1 = new Date(e1.startTime).getTime();
        const end1 = e1.endTime ? new Date(e1.endTime).getTime() : Date.now();
        const start2 = new Date(e2.startTime).getTime();
        const end2 = e2.endTime ? new Date(e2.endTime).getTime() : Date.now();

        if (start1 < end2 && start2 < end1) {
          overlappingPairs.push({ e1, e2 });
        } else if (start2 >= end1) {
          // Since it's sorted by start time, if start2 >= end1,
          // no subsequent entries will overlap with e1.
          break;
        }
      }
    }
    return overlappingPairs;
  }, [filteredEntries]);
"""

content = content.replace(
    "  const timecodeData = useMemo(() => {",
    overlap_logic + "\n  const timecodeData = useMemo(() => {"
)

with open('src/components/AnalysisView.tsx', 'w') as f:
    f.write(content)
