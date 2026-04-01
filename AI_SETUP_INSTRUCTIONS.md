# AI Feature Setup Instructions

## Problem
AI parsing feature shows "Failed to parse transaction with Gemini" error because API key is not configured.

## Solution: Get Free Gemini API Key

### Step 1: Get Gemini API Key (Free)
1. Visit: https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the generated API key

### Step 2: Configure API Key
1. Open `src/lib/config.ts`
2. Replace `YOUR_GEMINI_API_KEY` with your actual API key:

```typescript
export const GEMINI_API_KEY = 'AIzaSy...your-actual-key-here';
```

### Step 3: Rebuild App
```bash
npm run android
# or
npm run ios
```

## Alternative: Use Manual Mode Only

If you don't want to use AI features:
1. Open the Add screen
2. Click "Manual Mode" button
3. Enter transaction details manually

## Security Note
- Never commit `src/lib/config.ts` to Git
- Add it to `.gitignore` to keep your API key secure
- The Gemini API has a free tier with generous limits

## Troubleshooting

### Error: "API Key Missing"
- Make sure you replaced `YOUR_GEMINI_API_KEY` with actual key
- Rebuild the app after changing config

### Error: "Gemini API error: 400"
- Check if API key is valid
- Make sure there are no extra spaces in the key

### Error: "Could not extract JSON"
- This is a parsing issue with AI response
- Try rephrasing your transaction description
- Use Manual mode as fallback
