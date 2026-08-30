const fs = require('fs');

let file = 'src/components/FeeWithTrackedTime.test.tsx';
let content = fs.readFileSync(file, 'utf8');

// The test expects "1h 0m", but because of our change to formatDurationShort to strip "0m",
// it is probably looking for "1h". Let's check what formatDurationShort actually outputs.
// formatDurationShort(3600) -> 60 minutes -> 1h (if mins is 0, it doesn't show 0m).
// Oh! Previously formatDuration returned "1h 0m".
// We need to update the test to expect "1h".
content = content.replace(
  /expect\(screen\.getByText\('1h 0m'\)\)\.not\.toBeNull\(\);/g,
  `expect(screen.getByText('1h')).not.toBeNull();`
);

fs.writeFileSync(file, content);
