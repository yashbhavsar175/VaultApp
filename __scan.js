const fs = require('fs');
const path = require('path');

function scanDir(dir) {
  const results = [];
  const items = fs.readdirSync(dir);
  for (const item of items) {
    const full = path.join(dir, item);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      if (!['node_modules', '.git', 'android', 'ios', '__tests__', '.gradle'].includes(item)) {
        results.push(...scanDir(full));
      }
    } else if (/\.(ts|tsx)$/.test(item) && !item.includes('.test.') && !item.includes('.manual.')) {
      results.push(full);
    }
  }
  return results;
}

const files = scanDir('src');
const issues = [];

for (const file of files) {
  const content = fs.readFileSync(file, 'utf8');
  const lines = content.split('\n');
  const relFile = file.replace(/\\/g, '/');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 1. Static sender/bank/package lists
    if (/const\s+\w+(?:_SENDERS|_BANKS|_PACKAGES|CATEGORIES|_LIST)\s*(?::\s*\w+)?\s*=\s*\[/.test(line)) {
      issues.push({ file: relFile, line: i+1, type: 'STATIC_LIST', detail: line.trim().slice(0, 100) });
    }

    // 2. Hardcoded Record<string, string> maps
    if (/const\s+\w+:\s*Record<string,\s*string>\s*=\s*\{/.test(line)) {
      issues.push({ file: relFile, line: i+1, type: 'STATIC_MAP', detail: line.trim().slice(0, 100) });
    }

    // 3. delete() calls on supabase (potential data loss)
    if (/\.delete\(\)/.test(line) && /supabase/.test(content.slice(0, 500))) {
      issues.push({ file: relFile, line: i+1, type: 'DELETE_CALL', detail: line.trim().slice(0, 100) });
    }

    // 4. removeItem from AsyncStorage (potential local data loss)
    if (/removeItem/.test(line) && /AsyncStorage/.test(content)) {
      issues.push({ file: relFile, line: i+1, type: 'ASYNC_REMOVE', detail: line.trim().slice(0, 100) });
    }

    // 5. Hardcoded ALLOWED_PACKAGES or similar whitelists
    if (/ALLOWED_PACKAGES/.test(line) && /const/.test(line)) {
      issues.push({ file: relFile, line: i+1, type: 'WHITELIST', detail: line.trim().slice(0, 100) });
    }

    // 6. Hardcoded PACKAGE_TO_SENDER maps
    if (/PACKAGE_TO_SENDER/.test(line) && /const/.test(line)) {
      issues.push({ file: relFile, line: i+1, type: 'STATIC_MAP', detail: line.trim().slice(0, 100) });
    }
    
    // 7. Direct .clear() on caches or storages
    if (/\.clear\(\)/.test(line)) {
      issues.push({ file: relFile, line: i+1, type: 'CLEAR_CALL', detail: line.trim().slice(0, 100) });
    }

    // 8. Hardcoded bank names in logic (not in lists)
    if (/(?:HDFC|ICICI|SBI|KOTAK|AXIS|BOB|PNB|CANARA|UNION|IDBI|YES|FEDERAL|BANDHAN|INDUSIND)/i.test(line) && 
        !line.trim().startsWith('//') && !line.trim().startsWith('*') && !line.includes('.test.')) {
      // Only flag if it's in logic, not comments
      if (!/\/\//.test(line.split(/HDFC|ICICI|SBI/i)[0])) {
        issues.push({ file: relFile, line: i+1, type: 'HARDCODED_BANK', detail: line.trim().slice(0, 100) });
      }
    }
  }
}

// Print grouped
const grouped = {};
for (const issue of issues) {
  if (!grouped[issue.type]) grouped[issue.type] = [];
  grouped[issue.type].push(issue);
}

for (const type of Object.keys(grouped)) {
  console.log('\n=== ' + type + ' (' + grouped[type].length + ' issues) ===');
  // Deduplicate by file
  const byFile = {};
  for (const item of grouped[type]) {
    if (!byFile[item.file]) byFile[item.file] = [];
    byFile[item.file].push(item);
  }
  for (const f of Object.keys(byFile)) {
    console.log('  ' + f + ':');
    for (const item of byFile[f].slice(0, 5)) {
      console.log('    L' + item.line + ': ' + item.detail);
    }
    if (byFile[f].length > 5) console.log('    ... and ' + (byFile[f].length - 5) + ' more');
  }
}

console.log('\nTotal issues: ' + issues.length);
