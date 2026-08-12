import re

with open('src/types/index.ts', 'r') as f:
    content = f.read()
content = content.replace("  encryptionEnabled: boolean;\n", "")
with open('src/types/index.ts', 'w') as f:
    f.write(content)

with open('src/context/TimeTrackerContext.tsx', 'r') as f:
    content = f.read()
content = content.replace("        encryptionEnabled: false,\n", "")
with open('src/context/TimeTrackerContext.tsx', 'w') as f:
    f.write(content)

with open('src/db/index.ts', 'r') as f:
    content = f.read()
content = content.replace("    encryptionEnabled: false,\n", "")
with open('src/db/index.ts', 'w') as f:
    f.write(content)
