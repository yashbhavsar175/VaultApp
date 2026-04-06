#!/usr/bin/env node

/**
 * Environment Setup Verification Script
 * 
 * Yeh script check karta hai ki environment configuration sahi se setup hai ya nahi
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 Verifying Environment Setup...\n');

let hasErrors = false;

// Check 1: env.ts file exists
const envPath = path.join(__dirname, 'src', 'config', 'env.ts');
if (!fs.existsSync(envPath)) {
  console.log('❌ Error: src/config/env.ts file not found!');
  console.log('   Solution: cp src/config/env.example.ts src/config/env.ts\n');
  hasErrors = true;
} else {
  console.log('✅ env.ts file exists');
  
  // Check if it has actual values (not example values)
  const envContent = fs.readFileSync(envPath, 'utf8');
  
  if (envContent.includes('your-project.supabase.co')) {
    console.log('⚠️  Warning: env.ts still has example values');
    console.log('   Please fill in your actual Supabase URL\n');
    hasErrors = true;
  } else {
    console.log('✅ Supabase URL configured');
  }
  
  if (envContent.includes('your-supabase-anon-key-here') || 
      envContent.includes('your-actual-supabase-anon-key')) {
    console.log('⚠️  Warning: env.ts still has example Supabase key');
    console.log('   Please fill in your actual Supabase anon key\n');
    hasErrors = true;
  } else {
    console.log('✅ Supabase anon key configured');
  }
  
  if (envContent.includes('your-gemini-api-key-here') || 
      envContent.includes('your-actual-gemini-api-key')) {
    console.log('⚠️  Warning: env.ts still has example Gemini key');
    console.log('   Please fill in your actual Gemini API key\n');
    hasErrors = true;
  } else {
    console.log('✅ Gemini API key configured');
  }
}

// Check 2: env.example.ts exists
const examplePath = path.join(__dirname, 'src', 'config', 'env.example.ts');
if (!fs.existsSync(examplePath)) {
  console.log('❌ Error: src/config/env.example.ts file not found!');
  hasErrors = true;
} else {
  console.log('✅ env.example.ts file exists');
}

// Check 3: .gitignore has env.ts
const gitignorePath = path.join(__dirname, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  if (gitignoreContent.includes('src/config/env.ts')) {
    console.log('✅ env.ts is in .gitignore');
  } else {
    console.log('❌ Error: env.ts is NOT in .gitignore!');
    console.log('   Add this line to .gitignore: src/config/env.ts\n');
    hasErrors = true;
  }
} else {
  console.log('⚠️  Warning: .gitignore file not found');
}

// Check 4: Verify imports in supabase.ts
const supabasePath = path.join(__dirname, 'src', 'lib', 'supabase.ts');
if (fs.existsSync(supabasePath)) {
  const supabaseContent = fs.readFileSync(supabasePath, 'utf8');
  if (supabaseContent.includes("from '../config/env'")) {
    console.log('✅ supabase.ts imports from env.ts');
  } else {
    console.log('❌ Error: supabase.ts does not import from env.ts');
    hasErrors = true;
  }
}

// Check 5: Verify imports in config.ts
const configPath = path.join(__dirname, 'src', 'lib', 'config.ts');
if (fs.existsSync(configPath)) {
  const configContent = fs.readFileSync(configPath, 'utf8');
  if (configContent.includes("from '../config/env'")) {
    console.log('✅ config.ts imports from env.ts');
  } else {
    console.log('❌ Error: config.ts does not import from env.ts');
    hasErrors = true;
  }
}

console.log('\n' + '='.repeat(50));

if (hasErrors) {
  console.log('❌ Setup incomplete! Please fix the errors above.\n');
  console.log('📖 Read ENVIRONMENT_SETUP.md for detailed instructions.\n');
  process.exit(1);
} else {
  console.log('✅ All checks passed! Environment is properly configured.\n');
  console.log('🎉 Your sensitive data is now secure!\n');
  process.exit(0);
}
