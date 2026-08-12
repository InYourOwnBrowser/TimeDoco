import re

with open('src/components/AnalysisView.tsx', 'r') as f:
    content = f.read()

timeline_ui = """
        {/* Timeline View - Only show if range is exactly one day (e.g. preset 'today' or custom 1-day range) */}
        {dateRange.start.getTime() === startOfDay(dateRange.start).getTime() &&
         dateRange.end.getTime() === endOfDay(dateRange.start).getTime() && (
          <div className="mb-8">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-white mb-4 text-center">Daily Timeline</h3>
            <div className="relative h-12 bg-gray-200 dark:bg-gray-800 rounded-md overflow-hidden border border-gray-300 dark:border-gray-700">
              {/* Hour markers */}
              {Array.from({ length: 25 }).map((_, i) => (
                <div
                  key={i}
                  className="absolute top-0 bottom-0 border-l border-gray-300 dark:border-gray-600/50"
                  style={{ left: `${(i / 24) * 100}%` }}
                >
                  <span className="absolute top-full mt-1 -ml-3 text-[10px] text-gray-400">
                    {i % 4 === 0 ? (i === 0 || i === 24 ? '12A' : i === 12 ? '12P' : i > 12 ? `${i - 12}P` : `${i}A`) : ''}
                  </span>
                </div>
              ))}

              {/* Time blocks */}
              {filteredEntries.map(entry => {
                const entryStart = parseISO(entry.startTime);
                const entryEnd = entry.endTime ? parseISO(entry.endTime) : new Date();

                const dayStart = dateRange.start;
                const totalDaySeconds = 86400;

                const startSeconds = Math.max(0, differenceInSeconds(entryStart, dayStart));
                const endSeconds = Math.min(totalDaySeconds, differenceInSeconds(entryEnd, dayStart));

                if (startSeconds >= totalDaySeconds || endSeconds <= 0) return null;

                const leftPercent = (startSeconds / totalDaySeconds) * 100;
                const widthPercent = ((endSeconds - startSeconds) / totalDaySeconds) * 100;

                const tc = timecodes.find(t => t.id === entry.timecodeId);
                const color = tc?.color || groups.find(g => g.id === tc?.groupId)?.color || '#cbd5e1';

                return (
                  <div
                    key={entry.id}
                    className="absolute top-0 bottom-0 opacity-80 hover:opacity-100 transition-opacity"
                    style={{ left: `${leftPercent}%`, width: `${widthPercent}%`, backgroundColor: color }}
                    title={`${tc?.name || 'Unknown'} (${format(entryStart, 'h:mm a')} - ${entry.endTime ? format(entryEnd, 'h:mm a') : 'Now'})`}
                  ></div>
                );
              })}
            </div>
            <div className="h-6"></div> {/* Spacer for labels */}
          </div>
        )}
"""

content = content.replace(
    "        {timecodeData.length > 0 ? (",
    timeline_ui + "\n        {timecodeData.length > 0 ? ("
)

with open('src/components/AnalysisView.tsx', 'w') as f:
    f.write(content)
