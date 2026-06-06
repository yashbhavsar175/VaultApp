# Environment Configuration Setup

## 🔐 Sensitive Data ko Secure Kaise Karein

Yeh app sensitive API keys aur credentials use karta hai. Security ke liye, yeh sab ek alag file mein store kiye gaye hain.

## Setup Steps

### 1. Environment File Banayein

```bash
# Example file ko copy karein
cp src/config/env.example.ts src/config/env.ts
```

### 2. Apni API Keys Fill Karein

`src/config/env.ts` file ko open karein aur apni actual values fill karein:

```typescript
// Supabase Configuration
export const SUPABASE_URL = 'https://your-project.supabase.co';
export const SUPABASE_ANON_KEY = 'your-actual-supabase-anon-key';

// AI Configuration
export const GEMINI_API_KEY = 'your-actual-gemini-api-key';
```

### 3. Verify .gitignore

Check karein ki `src/config/env.ts` file `.gitignore` mein hai:

```
# .gitignore file mein yeh line honi chahiye
src/config/env.ts
```

## 📁 File Structure

```
src/
├── config/
│   ├── env.ts              ← Your actual keys (NEVER commit this)
│   └── env.example.ts      ← Template file (safe to commit)
└── lib/
    ├── supabase.ts         ← Uses env.ts
    └── config.ts           ← Uses env.ts
```

## 🔑 Kahan Se Keys Milenge

### Supabase Keys
1. [Supabase Dashboard](https://app.supabase.com) par jao
2. Apna project select karo
3. Settings → API section mein jao
4. Copy karo:
   - `Project URL` → `SUPABASE_URL`
   - `anon/public key` → `SUPABASE_ANON_KEY`

### Gemini API Key
1. [Google AI Studio](https://makersuite.google.com/app/apikey) par jao
2. "Create API Key" click karo
3. Key copy karo → `GEMINI_API_KEY`

## ⚠️ Important Security Rules

### ✅ DO (Karna Chahiye)
- `env.ts` file ko `.gitignore` mein rakhein
- `env.example.ts` file ko commit karein (bina actual keys ke)
- Production mein environment variables use karein
- Keys ko regularly rotate karein

### ❌ DON'T (Nahi Karna Chahiye)
- `env.ts` file ko Git mein commit na karein
- Keys ko code mein directly hardcode na karein
- Keys ko screenshots/emails mein share na karein
- Public repositories mein keys expose na karein

## 🚀 Usage in Code

Ab aap kisi bhi file mein easily import kar sakte hain:

```typescript
// Supabase keys
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/env';

// AI keys
import { GEMINI_API_KEY } from '../config/env';

// App config
import { APP_NAME, FEATURES } from '../config/env';
```

## 🔄 Existing Code Compatibility

Purane code ko break nahi hoga. `src/lib/config.ts` ab bhi kaam karega:

```typescript
// Yeh ab bhi kaam karega
import { GEMINI_API_KEY } from '../lib/config';
```

## 📤 Code Share Karte Waqt

Jab aap code share karein:

1. ✅ `env.example.ts` file share karein
2. ✅ Setup instructions share karein
3. ❌ `env.ts` file KABHI share na karein
4. ✅ Receiver ko bolo ki apni keys fill karein

## 🛠️ Troubleshooting

### Error: Cannot find module '../config/env'

**Solution:**
```bash
cp src/config/env.example.ts src/config/env.ts
# Then fill in your actual keys
```

### Error: Invalid API key

**Solution:**
- Check ki aapne correct keys fill ki hain
- Supabase dashboard mein verify karein
- Keys mein extra spaces na ho

### Git mein env.ts commit ho rahi hai

**Solution:**
```bash
# File ko Git se remove karein (disk se nahi)
git rm --cached src/config/env.ts

# Verify .gitignore
cat .gitignore | grep env.ts
```

## 📝 Notes

- `env.ts` file local machine par hi rahegi
- Har developer ko apni khud ki `env.ts` file banani hogi
- Production deployment ke liye environment variables use karein
- CI/CD pipelines mein secrets management use karein

## 🔐 Production Deployment

Production mein, environment variables use karein:

```bash
# Example for production
export SUPABASE_URL="https://prod.supabase.co"
export SUPABASE_ANON_KEY="prod-key-here"
export GEMINI_API_KEY="prod-gemini-key"
```

Aur code mein:

```typescript
export const SUPABASE_URL = process.env.SUPABASE_URL || 'fallback-url';
```
