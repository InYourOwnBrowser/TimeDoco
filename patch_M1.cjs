const fs = require('fs');

let file = 'src/components/AnalysisView.tsx';
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
  /const formatDuration = \(seconds: number\) => \{\n\s*const hrs = Math\.floor\(seconds \/ 3600\);\n\s*const mins = Math\.floor\(\(seconds % 3600\) \/ 60\);\n\s*if \(hrs > 0\) return mins > 0 \? \`\$\{hrs\}h \$\{mins\}m\` : \`\$\{hrs\}h\`;\n\s*return \`\$\{mins\}m\`;\n\s*\};\n/,
  `const formatDuration = formatDurationShort;\n`
);

fs.writeFileSync(file, content);
