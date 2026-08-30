const fs = require('fs');

// 1. M-1 (Negative Duration) in src/components/AnalysisView.tsx
let file = 'src/components/AnalysisView.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /const formatDuration = \(seconds: number\) => \{\n\s*const hrs = Math\.floor\(seconds \/ 3600\);\n\s*const mins = Math\.floor\(\(seconds % 3600\) \/ 60\);\n\s*if \(hrs > 0\) return mins > 0 \? `\$\{hrs\}h \$\{mins\}m` : `\$\{hrs\}h`;\n\s*return `\$\{mins\}m`;\n\s*\};\n/g,
  `const formatDuration = formatDurationShort;\n`
);
fs.writeFileSync(file, content);

// 2. formatDurationShort in src/utils/timeUtils.ts
file = 'src/utils/timeUtils.ts';
content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /export const formatDurationShort = \(totalSeconds: number\): string => \{\n\s*if \(\!Number\.isFinite\(totalSeconds\) \|\| totalSeconds <= 0\) return '—';\n\s*\/\/ Round to whole minutes first, then decompose\. Rounding the minute part on\n\s*\/\/ its own produces impossible readings such as "1h 60m" at 7199 seconds\.\n\s*const totalMinutes = Math\.round\(totalSeconds \/ 60\);\n\s*const hrs = Math\.floor\(totalMinutes \/ 60\);\n\s*const mins = totalMinutes % 60;\n\s*if \(hrs > 0\) return mins > 0 \? `\$\{hrs\}h \$\{mins\}m` : `\$\{hrs\}h`;\n\s*return `\$\{mins\}m`;\n\s*\};/,
  `export const formatDurationShort = (totalSeconds: number): string => {
  if (!Number.isFinite(totalSeconds)) return '—';
  if (totalSeconds === 0) return '—';

  const isNegative = totalSeconds < 0;
  const absSeconds = Math.abs(totalSeconds);

  // Round to whole minutes first, then decompose. Rounding the minute part on
  // its own produces impossible readings such as "1h 60m" at 7199 seconds.
  const totalMinutes = Math.round(absSeconds / 60);

  if (totalMinutes === 0) return '—';

  const hrs = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  let formatted = \`\${mins}m\`;
  if (hrs > 0) {
    formatted = mins > 0 ? \`\${hrs}h \${mins}m\` : \`\${hrs}h\`;
  }

  return isNegative ? \`-\${formatted}\` : formatted;
};`
);
fs.writeFileSync(file, content);

// 3. M-2 (Target Alert Label) in src/components/SettingsModal.tsx
file = 'src/components/SettingsModal.tsx';
content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /Target Alert \(Minutes\)/g,
  `Timer Alert (Minutes)`
);
content = content.replace(
  /Notifies you this many minutes before you hit your weekly target\./g,
  `Notifies you when any single timer has been running for this many minutes.`
);
fs.writeFileSync(file, content);

// 4. M-3 (Timesheet Slot Bleed) in src/utils/timeUtils.ts
file = 'src/utils/timeUtils.ts';
content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /for \(const candMs of candidates\) \{\n\s*const candEnd = new Date\(candMs \+ deltaSeconds \* 1000\);\n\s*if \(\n\s*\!checkOverlap\(\n\s*new Date\(candMs\),\n\s*candEnd,\n\s*entries,\n\s*excludeId,\n\s*timecodeId,\n\s*allowConcurrentTimers\n\s*\)\n\s*\) \{\n\s*return \{ start: new Date\(candMs\), end: candEnd \};\n\s*\}\n\s*\}/,
  `const dEndMs = new Date(day);
  dEndMs.setHours(23, 59, 59, 999);

  for (const candMs of candidates) {
    const candEnd = new Date(candMs + deltaSeconds * 1000);
    if (candEnd.getTime() > dEndMs.getTime()) continue;

    if (
      !checkOverlap(
        new Date(candMs),
        candEnd,
        entries,
        excludeId,
        timecodeId,
        allowConcurrentTimers
      )
    ) {
      return { start: new Date(candMs), end: candEnd };
    }
  }`
);
fs.writeFileSync(file, content);
