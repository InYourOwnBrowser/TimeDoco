import re

with open('audit_report.md', 'r') as f:
    content = f.read()

content = content.replace("- [ ] Timecode merge tool (§6.4)", "- [x] Timecode merge tool (§6.4)")
content = content.replace("- [ ] Entry splitting across timecodes (§7.5)", "- [x] Entry splitting across timecodes (§7.5)")
content = content.replace("- [ ] Gap detection on Analysis page (§8.13, \"overlaps *or* gaps\")", "- [x] Gap detection on Analysis page (§8.13, \"overlaps *or* gaps\")")

with open('audit_report.md', 'w') as f:
    f.write(content)
