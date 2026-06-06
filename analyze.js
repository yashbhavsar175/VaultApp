const fs = require('fs');
const path = require('path');

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) return;
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    if (isDirectory) {
      walkDir(dirPath, callback);
    } else {
      callback(path.join(dir, f));
    }
  });
}

const files = [];
walkDir('./src', (f) => files.push(f));
walkDir('./supabase', (f) => files.push(f));
files.push('./App.tsx');
files.push('./.env');
files.push('./.gitignore');
files.push('./package.json');
files.push('./app.json');

const issues = {
  critical: [],
  high: [],
  medium: [],
  low: [],
  info: []
};

function addIssue(severity, file, line, category, desc, fix) {
  issues[severity].push({ file, line, category, desc, fix });
}

files.forEach(file => {
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');

  // Security 1.1 Hardcoded Secrets
  lines.forEach((line, i) => {
    if (line.match(/sk-[a-zA-Z0-9]{20,}/)) addIssue('critical', file, i+1, 'Security', 'Hardcoded OpenAI/Gemini key found', 'Move to .env and use react-native-config');
    if (line.match(/anon_key.*=.*['"]eyJ/i) && !file.includes('.env.example')) addIssue('critical', file, i+1, 'Security', 'Hardcoded Supabase Anon Key found', 'Move to .env');
    if ((line.match(/supabase_url.*=.*['"]https/i) || (line.includes('https://') && line.includes('.supabase.co'))) && !file.includes('.env') && !file.includes('.md')) {
       if (file.includes('config') || line.includes('const') || line.includes('url:')) addIssue('high', file, i+1, 'Security', 'Hardcoded Supabase URL', 'Move to .env');
    }
  });

  if (file.endsWith('.env')) {
    const gitignore = fs.existsSync('./.gitignore') ? fs.readFileSync('./.gitignore', 'utf-8') : '';
    if (!gitignore.includes('.env')) {
      addIssue('critical', '.gitignore', 0, 'Security', '.env is not in .gitignore', 'Add .env to .gitignore');
    }
  }

  // Security 1.3 Auth & Session
  if (file.endsWith('.tsx') || file.endsWith('.ts')) {
     lines.forEach((line, i) => {
        if (line.includes('AsyncStorage.setItem') && line.includes('token')) {
           addIssue('high', file, i+1, 'Security', 'AsyncStorage used for tokens', 'Use EncryptedStorage on Android or react-native-keychain');
        }
        if (line.includes('console.log') && (line.toLowerCase().includes('token') || line.toLowerCase().includes('password') || line.toLowerCase().includes('user'))) {
           addIssue('high', file, i+1, 'Security', 'Logging sensitive data', 'Remove console.log for sensitive data');
        }
     });
  }

  // Bug 2.2 RN
  if (file.endsWith('.tsx')) {
    if (content.includes('FlatList') && content.includes('ScrollView') && !file.includes('VirtualizedList')) {
       addIssue('medium', file, 0, 'Bug', 'Possible FlatList inside ScrollView causing VirtualizedList errors', 'Remove ScrollView wrapper or use map');
    }
    if (content.includes('FlatList') && !content.includes('keyExtractor')) {
       addIssue('medium', file, 0, 'Bug', 'FlatList missing keyExtractor', 'Add keyExtractor prop for better performance and list stability');
    }
    // Bug 2.1 Stale closures
    if (content.includes('setInterval(') && !content.includes('clearInterval(')) {
       addIssue('high', file, 0, 'Bug', 'setInterval without clearInterval', 'Clear interval on unmount');
    }
  }

  // Performance 3.1
  if (file.endsWith('.ts') || file.endsWith('.tsx')) {
    lines.forEach((line, i) => {
       if (line.includes('.select(') && line.includes('*') && !file.includes('schema')) {
          addIssue('low', file, i+1, 'Performance', 'Select * used in query (N+1 pattern or overfetching)', 'Select only required columns');
       }
    });
  }

  // UI 4.1 Theme
  if (file.endsWith('.tsx') || file.endsWith('.ts')) {
    lines.forEach((line, i) => {
       if (line.match(/color:\s*['"]#[0-9a-fA-F]{3,6}['"]/)) {
          addIssue('medium', file, i+1, 'UI/UX', 'Hardcoded color hex used', 'Use theme colors from useTheme() to support dark mode consistently');
       }
       if (line.includes('StyleSheet.create') && line.includes('backgroundColor: \'#')) {
          addIssue('medium', file, i+1, 'UI/UX', 'Hardcoded background color', 'Use useTheme');
       }
    });
  }

  // Architecture 5.2 Any types
  if (file.endsWith('.ts') || file.endsWith('.tsx')) {
    lines.forEach((line, i) => {
       if ((line.includes(': any') || line.includes('as any')) && !line.includes('//')) {
          addIssue('info', file, i+1, 'Code Quality', 'any type used', 'Define proper TypeScript interface');
       }
       if (line.includes('@ts-ignore')) {
          addIssue('medium', file, i+1, 'Code Quality', '@ts-ignore used', 'Fix the underlying TypeScript error instead of ignoring');
       }
    });
  }
  
  // 5.3 Error Handling
  if (file.endsWith('.ts') || file.endsWith('.tsx')) {
      if (content.includes('supabase.from') && !content.includes('catch') && !content.includes('error')) {
         addIssue('high', file, 0, 'Code Quality', 'Supabase call without error handling', 'Wrap in try/catch or check error object');
      }
  }
});

// Check Supabase RLS
const sqlFiles = files.filter(f => f.endsWith('.sql'));
sqlFiles.forEach(file => {
   const content = fs.readFileSync(file, 'utf-8');
   if (content.toUpperCase().includes('CREATE TABLE') && !content.toUpperCase().includes('ENABLE ROW LEVEL SECURITY')) {
      addIssue('high', file, 0, 'Security', 'Table creation without explicitly enabling RLS in same file (verify if it is done elsewhere)', 'Ensure RLS is enabled on all tables');
   }
   if (content.toUpperCase().includes('CREATE OR REPLACE FUNCTION') && !content.toUpperCase().includes('SECURITY DEFINER') && !content.toUpperCase().includes('SECURITY INVOKER')) {
      addIssue('info', file, 0, 'Security', 'Function missing explicit SECURITY DEFINER/INVOKER', 'Define security context explicitly');
   }
});

fs.writeFileSync('audit_results.json', JSON.stringify(issues, null, 2));
console.log('Analysis complete. Results in audit_results.json');
