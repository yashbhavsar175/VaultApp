# VaultApp - Personal Finance Tracker

A React Native CLI app for tracking income, expenses, investments, and EMI payments with AI-powered transaction parsing.

## Tech Stack

- React Native CLI (TypeScript)
- Supabase (Authentication & Database)
- React Navigation v6 (Bottom Tab Navigator)
- AsyncStorage (Auth token persistence)
- react-native-vector-icons (MaterialCommunityIcons)
- react-native-toast-message (Notifications)
- OpenAI GPT-4o-mini / Gemini 1.5 Flash (AI parsing)

## Project Structure

```
VaultApp/
├── src/
│   ├── components/        # Reusable components (empty for now)
│   ├── hooks/            # Custom hooks (empty for now)
│   ├── lib/
│   │   ├── aiParser.ts   # AI transaction parsing logic
│   │   ├── config.ts     # API keys (gitignored)
│   │   ├── db.ts         # Supabase database functions
│   │   └── supabase.ts   # Supabase client setup
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
├── supabase-setup.sql    # Database schema & RLS policies
└── App.tsx              # Root component
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Supabase

1. Create a Supabase project at https://supabase.com
2. Run the SQL in `supabase-setup.sql` in your Supabase SQL Editor
3. Update `src/lib/supabase.ts` with your Supabase URL and Anon Key

### 3. Configure AI Provider

1. Copy `src/lib/config.ts` and add your API key:
   - For OpenAI: Get key from https://platform.openai.com/api-keys
   - For Gemini: Get key from https://aistudio.google.com/app/apikey
2. Choose your provider in `config.ts` (default: Gemini)

### 4. Run the App

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
- **AI Mode**: Natural language parsing (e.g., "200 rs petrol")
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

- `src/lib/config.ts` is gitignored to protect API keys
- Never commit API keys to version control
- RLS policies ensure data isolation between users

## License

MIT
