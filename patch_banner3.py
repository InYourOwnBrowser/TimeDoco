import re

with open('src/components/BackupReminderBanner.tsx', 'r') as f:
    content = f.read()

# Fix unused parameter by removing it (valid JS/TS)
content = content.replace("} catch (_e) {", "} catch {")

with open('src/components/BackupReminderBanner.tsx', 'w') as f:
    f.write(content)
