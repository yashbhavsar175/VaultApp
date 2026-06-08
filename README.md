# VaultApp - Personal Finance Tracker

A React Native CLI app for tracking income, expenses, investments, and EMI payments with AI-powered transaction parsing through a Supabase Edge Function.

## Tech Stack

- React Native CLI (TypeScript)
- Supabase (Authentication & Database)
- React Navigation v6 (Bottom Tab Navigator)
- EncryptedStorage (Auth token persistence)
- react-native-vector-icons (MaterialCommunityIcons)
- react-native-toast-message (Notifications)
- OpenAI GPT-4o-mini via Supabase Edge Function (AI parsing)

## Project Structure

```
VaultApp/
├── src/
│   ├── components/        # Reusable components (empty for now)
│   ├── hooks/            # Custom hooks (empty for now)
│   ├── lib/
│   │   ├── core.ts       # Supabase client, auth, transactions
│   │   ├── database/     # Supabase database functions
│   │   └── services/     # Cache, notifications, native helpers
│   ├── navigation/
│   │   └── BottomTabNavigator.tsx
│   ├── screens/
│   │   ├── Add.tsx           # Add transaction (AI + Manual modes)
│   │   ├── Dashboard.tsx     # Overview with stats
│   │   ├── LoginScreen.tsx   # Authentication
│   │   ├── Settings.tsx      # User settings & logout
│   │   ├── SignupScreen.tsx  # User registration
│   │   └── Transactions.tsx  # Transaction list with filters
│   └── types/
│       └── index.ts      # TypeScript types
├── docs/                 # Project notes and archived setup docs
├── docs/sql-archive/     # Archived standalone SQL snippets
├── supabase-fresh-setup.sql # Canonical database schema & RLS policies
└── App.tsx              # Root component
```

Additional project documentation lives in `docs/`. Archived standalone SQL files live in `docs/sql-archive/`; use `supabase-fresh-setup.sql` as the canonical fresh database setup unless a task explicitly calls for an archived snippet.

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

1. Copy `.env.example` to `.env`
2. Fill in:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `GOOGLE_WEB_CLIENT_ID`
   - `GOOGLE_MAPS_API_KEY` if you use map/distance features
3. Keep `.env` private. It is already ignored by Git.

### 3. Configure Supabase

1. Create a Supabase project at https://supabase.com
2. Run the SQL in `supabase-fresh-setup.sql` in your Supabase SQL Editor
3. Configure Supabase URL and anon key through `.env` / `react-native-config`

### 4. Configure AI Parsing

The mobile app does not call OpenAI directly. It calls `supabase/functions/parse-transaction`, and the Edge Function reads `OPENAI_API_KEY` from Supabase Function secrets.

For local Edge Function development, use the placeholder in `.env.example`, then replace it in your private `.env`:

```bash
OPENAI_API_KEY=your_openai_key_here
OPENAI_MODEL=gpt-4o-mini
```

For production, set the secret in Supabase:

```bash
supabase secrets set OPENAI_API_KEY=your_real_key
supabase functions deploy parse-transaction
```

### 5. Run the App

#### iOS
```bash
npx react-native run-ios
```

#### Android
```bash
npx react-native run-android
```

## Features

### Authentication
- Email/password signup and login
- Session persistence with AsyncStorage
- Secure logout

### Dashboard
- Net balance calculation
- Income, Expense, Investment, and EMI totals
- Recent transactions (last 5)
- Personalized greeting with date
- Pull to refresh

### Add Transaction
- **AI Mode**: Natural language parsing through the `parse-transaction` Edge Function, with review before save
- **Manual Mode**: Form-based entry
- Transaction types: Income, Expense, Investment, EMI
- Category tagging

### Transactions
- Filterable list (All, Income, Expense, Investment, EMI)
- Long press to delete
- Pull to refresh
- Empty state handling

### Settings
- Display user email
- Sign out functionality
- App version info

## Design System

### Colors
- Background: `#0a0a0f`
- Card background: `#1a1a26`
- Border: `#2a2a3d`
- Accent (purple): `#7c6af7`
- Income (green): `#10b981`
- Expense (red): `#ef4444`
- Investment (purple): `#7c6af7`
- EMI (amber): `#f59e0b`

### Currency Format
All amounts use Indian locale formatting: ₹1,00,000

## Database Schema

### transactions table
- `id`: uuid (primary key)
- `user_id`: uuid (foreign key to auth.users)
- `amount`: numeric
- `type`: text (income|expense|investment|emi)
- `note`: text
- `category`: text
- `created_at`: timestamptz

### Row Level Security
- Users can only access their own transactions
- Full CRUD permissions for own data

## Security Notes

- Runtime configuration is loaded from `.env` through `react-native-config`
- Provider secrets such as `OPENAI_API_KEY` belong in Supabase Function secrets, not mobile source code
- Never commit API keys to version control
- RLS policies ensure data isolation between users

## License

MIT
