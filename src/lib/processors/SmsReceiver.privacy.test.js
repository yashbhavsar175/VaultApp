const fs = require('fs');
const path = require('path');

describe('native SmsReceiver sender logging privacy', () => {
  it('logs only structural sender fields before filtering', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '../../../android/app/src/main/java/com/spendsense/SmsReceiver.kt'),
      'utf8'
    );

    expect(source).toContain('senderPresent=${sender.isNotBlank()} senderKind=$senderKind');
    expect(source).not.toContain('SMS Received from: $sender');
    expect(source).not.toMatch(/Log\.[a-z]+\([^)]*\$sender[^A-Za-z]/i);
  });
});
