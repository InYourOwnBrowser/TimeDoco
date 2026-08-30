const fs = require('fs');

let file = 'src/components/AnalysisView.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /const formatDuration = \(seconds: number\) => \{\n\s*const hrs = Math\.floor\(seconds \/ 3600\);\n\s*const mins = Math\.floor\(\(seconds % 3600\) \/ 60\);\n\s*return \`\$\{hrs\}h \$\{mins\}m\`;\n\s*\};/,
  `const formatDuration = formatDurationShort;`
);

fs.writeFileSync(file, content);
