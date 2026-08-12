import re

with open('src/components/BackupReminderBanner.tsx', 'r') as f:
    content = f.read()

# Fix unused parameter
content = content.replace("} catch (e) {", "} catch (_e) {")

with open('src/components/BackupReminderBanner.tsx', 'w') as f:
    f.write(content)
