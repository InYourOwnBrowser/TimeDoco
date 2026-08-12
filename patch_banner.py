import re

with open('src/components/BackupReminderBanner.tsx', 'r') as f:
    content = f.read()

# Replace sessionStorage with localStorage for dismissal flag and check for 1 day
content = content.replace(
    "const isDismissed = sessionStorage.getItem('backupReminderDismissed');",
    """const dismissalData = localStorage.getItem('backupReminderDismissed');
    let isDismissed = false;
    if (dismissalData) {
      try {
        const { timestamp } = JSON.parse(dismissalData);
        // Only keep dismissed if less than 24 hours ago
        if (Date.now() - timestamp < 24 * 60 * 60 * 1000) {
          isDismissed = true;
        } else {
          localStorage.removeItem('backupReminderDismissed');
        }
      } catch (e) {
        localStorage.removeItem('backupReminderDismissed');
      }
    }"""
)

content = content.replace(
    "sessionStorage.setItem('backupReminderDismissed', 'true');",
    "localStorage.setItem('backupReminderDismissed', JSON.stringify({ timestamp: Date.now() }));"
)

with open('src/components/BackupReminderBanner.tsx', 'w') as f:
    f.write(content)
