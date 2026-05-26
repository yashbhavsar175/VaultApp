/* eslint-env jest, node */

const fs = require('fs');
const path = require('path');

describe('manual Add refund exposure gate', () => {
  it('does not expose refund in the manual Add type selector', () => {
    const source = fs.readFileSync(path.join(__dirname, 'Add.tsx'), 'utf8');
    const typeOptions = source.match(/const TYPE_OPTIONS = \[([\s\S]*?)\];/);

    expect(typeOptions && typeOptions[1]).not.toContain("'refund'");
    expect(typeOptions && typeOptions[1]).not.toContain('"refund"');
  });
});
