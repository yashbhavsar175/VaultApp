# Profile Persistence Fix - SpendSense

## Issues Fixed

### 1. Profile Not Persisting After Logout/Login
**Problem**: After logout and login, user's name was not showing and profile screen appeared again.

**Solution**: Updated `App.tsx` to properly check profiles table after session is restored:
```typescript
const { data: profile } = await supabase
  .from('profiles')
  .select('full_name')
  .eq('id', userId)
  .single();

if (profile?.full_name) {
  // Profile exists → go to main app
  setNeedsProfile(false);
} else {
  // No profile → go to profile setup
  setNeedsProfile(true);
}
```

### 2. Profile Data Already Using UPSERT
**Status**: ✅ Already implemented correctly

`ProfileScreen.tsx` already uses UPSERT to update existing profiles:
```typescript
await supabase.from('profiles').upsert({
  id: user.id,
  full_name: fullName.trim(),
  phone: phone.trim() || null,
  monthly_budget: monthlyBudget ? parseFloat(monthlyBudget) : null,
  currency,
  updated_at: new Date().toISOString(),
});
```

### 3. Dashboard Profile Loading on Every Focus
**Problem**: Profile name was only loaded on mount, not when returning to the screen.

**Solution**: Separated profile loading into its own function and called it in `useFocusEffect`:
```typescript
const loadProfile = async () => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();
    
    if (profile?.full_name) {
      setUserName(profile.full_name);
    }
  }
};

useFocusEffect(
  React.useCallback(() => {
    loadData();
    loadProfile(); // Load profile on every focus
    // ...
  }, [])
);
```

### 4. Google Sign-In Name Pre-fill
**Problem**: Google users had to manually enter their name even though it was available from Google.

**Solution**: Added `loadGoogleUserName()` function in `ProfileScreen.tsx`:
```typescript
const loadGoogleUserName = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.user_metadata) {
    const metadata = session.user.user_metadata;
    const googleName = metadata.full_name || metadata.name;
    if (googleName) {
      setFullName(googleName);
    }
  }
};
```

## User Flow After Fixes

### First Time Login
1. User logs in (email or Google)
2. No profile exists → Profile setup screen appears
3. For Google users: Name is pre-filled from Google account
4. User fills/confirms name → Saves profile
5. Redirected to Main app with name showing ✅

### Subsequent Logins
1. User logs in (email or Google)
2. Profile exists in database → Directly to Main app
3. Dashboard loads and displays user's name ✅
4. Name persists across app restarts ✅

### Profile Updates
1. User edits profile from Settings
2. Changes saved with UPSERT (updates existing record)
3. Dashboard refreshes on focus → Shows updated name ✅

## Files Modified

1. **App.tsx**
   - Improved profile check logic
   - Cleaner conditional flow

2. **src/screens/ProfileScreen.tsx**
   - Added Google user name pre-fill
   - Already had UPSERT implementation

3. **src/screens/Dashboard.tsx**
   - Separated profile loading into dedicated function
   - Profile loads on every screen focus
   - Profile loads when app comes to foreground

## Testing Checklist

- [ ] First time email login → Profile screen appears
- [ ] Fill profile → Saves successfully → Main app shows name
- [ ] Logout → Login again → Directly to Main app with name
- [ ] First time Google login → Profile screen with pre-filled name
- [ ] Edit profile from Settings → Name updates on Dashboard
- [ ] Kill app → Reopen → Name still shows
- [ ] Switch between tabs → Name persists
- [ ] App goes to background → Returns → Name still shows

## Database Schema

Profiles table structure (already created):
```sql
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  full_name TEXT,
  phone TEXT,
  monthly_budget NUMERIC,
  currency TEXT DEFAULT 'INR',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

## Notes

- Profile data is stored in Supabase `profiles` table
- Session is saved to AsyncStorage for headless tasks
- Profile check happens on every auth state change
- Dashboard refreshes profile on every focus for latest data
- Google Sign-In metadata provides name automatically
