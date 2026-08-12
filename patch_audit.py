import re

with open('audit_report.md', 'r') as f:
    content = f.read()

# Mark the specific items as complete
content = content.replace(
    "- [ ] **No timeline/calendar day view**",
    "- [x] **No timeline/calendar day view**"
)
content = content.replace(
    "- [ ] **No overlap/gap detection on the Analysis page**",
    "- [x] **No overlap/gap detection on the Analysis page**"
)
content = content.replace(
    "- [ ] **No \"most recently/frequently used\" surfacing**",
    "- [x] **No \"most recently/frequently used\" surfacing**"
)
content = content.replace(
    "- [ ] **No hourly-rate editing after creation.**",
    "- [x] **No hourly-rate editing after creation.**"
)
content = content.replace(
    "- [ ] **No encryption-at-rest**",
    "- [x] **No encryption-at-rest**"
)
content = content.replace(
    "- [ ] **Backup reminder dismissal is per-session only**",
    "- [x] **Backup reminder dismissal is per-session only**"
)
content = content.replace(
    "- [ ] **No confirmation/undo on Archive.**",
    "- [x] **No confirmation/undo on Archive.**"
)
content = content.replace(
    "- [ ] **Multiple concurrent timers UX is asymmetric.**",
    "- [x] **Multiple concurrent timers UX is asymmetric.**"
)
content = content.replace(
    "- [ ] **Large single JS bundle.**",
    "- [x] **Large single JS bundle.**"
)

with open('audit_report.md', 'w') as f:
    f.write(content)
