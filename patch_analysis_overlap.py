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
    "  // Calculate totals by timecode",
    overlap_logic + "\n  // Calculate totals by timecode"
)

# Add overlap UI
import_lucide = "import { Download, Printer, AlertTriangle } from 'lucide-react';"
content = content.replace("import { Download, Printer } from 'lucide-react';", import_lucide)

overlap_ui = """
        {overlaps.length > 0 && (
          <div className="mb-8 p-4 bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-lg flex items-start gap-3">
            <AlertTriangle className="text-amber-500 mt-0.5 shrink-0" size={20} />
            <div>
              <h4 className="font-medium text-amber-800 dark:text-amber-300">Overlapping Entries Detected</h4>
              <p className="text-sm text-amber-700 dark:text-amber-400 mt-1">
                There are {overlaps.length} overlapping time entries in this period. Review your history in the Tracker tab to ensure your tracked time is accurate.
              </p>
            </div>
          </div>
        )}
"""

content = content.replace(
    "        {timecodeData.length > 0 ? (",
    overlap_ui + "\n        {timecodeData.length > 0 ? ("
)

with open('src/components/AnalysisView.tsx', 'w') as f:
    f.write(content)
