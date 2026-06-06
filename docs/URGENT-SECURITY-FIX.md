# 🚨 URGENT: API Keys Exposed in Git - Fix NOW!

## What Happened?
GitGuardian detected that your **Google Gemini API Key** and other secrets were pushed to Git.

## IMMEDIATE ACTIONS (Do in this order):

### 1️⃣ REVOKE ALL EXPOSED KEYS (Do this FIRST!)

#### Google Gemini API Key
```
Exposed Key: AIzaSyALymy6YOmp90d8aCOxYwPNUOZ3BcDC36Y
Action: https://console.cloud.google.com/apis/credentials
→ Find this key → Delete → Create new key
```

#### Supabase Keys
```
Exposed URL: https://zwszhrmxntqfjvontcfw.supabase.co
Exposed Anon Key: eyJhbGci...
Action: https://supabase.com/dashboard/project/zwszhrmxntqfjvontcfw/settings/api
→ Regenerate Anon Key
```

#### Google OAuth Client ID
```
Exposed ID: 1067695067282-vuh6jki8rl2ao8k4vnjo3t2v2hlm003p
Action: https://console.cloud.google.com/apis/credentials
→ Regenerate if needed
```

### 2️⃣ UPDATE .env FILE WITH NEW KEYS

After regenerating keys, update `.env`:
```bash
# Edit .env file with NEW keys
code .env

# Verify .env is in .gitignore
git check-ignore .env
# Should show: .gitignore:XX:.env    .env
```

### 3️⃣ CLEAN GIT HISTORY

**Option A: Using BFG Repo-Cleaner (Recommended - Fast)**

```bash
# Download BFG
# https://rtyley.github.io/bfg-repo-cleaner/

# Backup first!
cd ..
git clone VaultApp VaultApp-backup

# Clean secrets
cd VaultApp
java -jar bfg.jar --replace-text cleanup-secrets.txt

# Clean up
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Force push (⚠️ This rewrites history!)
git push origin --force --all
```

**Option B: Using git-filter-repo**

```bash
# Install
pip install git-filter-repo

# Backup first!
cd ..
git clone VaultApp VaultApp-backup

# Remove .env from history
cd VaultApp
git filter-repo --path .env --invert-paths --force

# Force push
git push origin --force --all
```

**Option C: Nuclear Option (If repo is new)**

```bash
# Backup important files
cp -r src ../src-backup
cp package.json ../package.json.backup

# Delete Git history
rm -rf .git

# Start fresh
git init
git add .
git commit -m "Initial commit with secured configuration"
git remote add origin YOUR_REPO_URL
git push -u origin main --force
```

### 4️⃣ VERIFY SECURITY

```bash
# Run security check
bash check-git-security.sh

# Verify .env is not tracked
git status

# Should NOT show .env in untracked files if it's properly ignored
```

### 5️⃣ PREVENT FUTURE LEAKS

#### Install git-secrets (Pre-commit hook)
```bash
# macOS
brew install git-secrets

# Linux
sudo apt-get install git-secrets

# Setup
git secrets --install
git secrets --register-aws
git secrets --add 'AIza[0-9A-Za-z-_]{35}'  # Google API Key pattern
git secrets --add 'eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*'  # JWT pattern
```

#### Add .gitattributes
```bash
echo ".env filter=git-crypt diff=git-crypt" >> .gitattributes
```

## ✅ CHECKLIST

- [ ] Revoked Google Gemini API Key
- [ ] Regenerated Supabase Keys
- [ ] Updated .env with NEW keys
- [ ] Verified .env is in .gitignore
- [ ] Cleaned Git history (chose one option above)
- [ ] Force pushed cleaned history
- [ ] Ran security check script
- [ ] Installed git-secrets for future protection
- [ ] Notified team members (if any) to re-clone

## 📞 SUPPORT

If you need help:
1. Check GitGuardian dashboard for more details
2. Review their remediation guide
3. Contact your team lead if this is a company project

## ⚠️ IMPORTANT NOTES

1. **Force push rewrites history** - All team members need to re-clone
2. **Old keys are INVALID** - Update them everywhere (CI/CD, local machines)
3. **Monitor usage** - Check Google Cloud Console for unauthorized API usage
4. **Set up billing alerts** - Prevent surprise charges if key was abused

## 🔒 CURRENT STATUS

✅ Code is already using react-native-config
✅ .env is in .gitignore
✅ Config file uses environment variables
❌ Git history contains exposed keys (NEEDS CLEANUP)
❌ Keys need to be revoked and regenerated (DO THIS FIRST!)
