#!/bin/bash

# Git Security Check Script
# Checks if sensitive files are properly ignored

echo "🔍 Checking Git Security..."
echo ""

# Check if .env is ignored
echo "1. Checking .env file..."
if git check-ignore -q .env; then
    echo "   ✅ .env is properly ignored"
else
    echo "   ❌ WARNING: .env is NOT ignored!"
    echo "   Add '.env' to .gitignore immediately!"
fi

# Check if .env exists in git history
echo ""
echo "2. Checking Git history for .env..."
if git log --all --full-history -- .env | grep -q "commit"; then
    echo "   ❌ WARNING: .env found in Git history!"
    echo "   You need to clean Git history (see .git-cleanup-instructions.md)"
else
    echo "   ✅ .env not found in Git history"
fi

# Check for hardcoded API keys in tracked files
echo ""
echo "3. Scanning for potential API keys in tracked files..."
if git grep -E "AIza[0-9A-Za-z-_]{35}|sk-[0-9A-Za-z]{48}" -- '*.ts' '*.tsx' '*.js' '*.jsx' 2>/dev/null; then
    echo "   ❌ WARNING: Potential API keys found in tracked files!"
else
    echo "   ✅ No obvious API keys found in tracked files"
fi

# Check if config files have placeholders
echo ""
echo "4. Checking config files..."
if grep -q "Config\." src/config/index.ts; then
    echo "   ✅ Config uses environment variables"
else
    echo "   ❌ WARNING: Config might have hardcoded values"
fi

echo ""
echo "📋 Summary:"
echo "   - Review .git-cleanup-instructions.md for cleanup steps"
echo "   - Regenerate ALL exposed API keys"
echo "   - Never commit .env file"
echo ""
