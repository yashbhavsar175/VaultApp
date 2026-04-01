# SpendSense Refactoring Guide

## Completed Components

### Design System (ThemeContext.tsx)
✅ Complete design system with:
- Colors (light/dark variants)
- Typography (h1, h2, h3, body, bodyBold, caption, button)
- Spacing (xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48)
- BorderRadius (sm: 8, md: 12, lg: 16, xl: 20, full: 9999)
- Shadows (sm, md, lg)

### Reusable Components Created

1. **Layout Components**
   - ✅ `ScreenWrapper` - SafeAreaView wrapper with theme background
   - ✅ `AppHeader` - Consistent header with back button and actions

2. **UI Components**
   - ✅ `Card` - Themed card container with optional onPress
   - ✅ `AppButton` - Button with variants (primary, secondary, danger)
   - ✅ `AppInput` - Text input with label, icon, and error support
   - ✅ `Badge` - Colored badge (success, danger, warning, info)

3. **Common Components**
   - ✅ `TransactionItem` - Transaction list item with amount formatting
   - ✅ `SectionHeader` - Section title with optional action

## Refactored Screens

### ✅ LoginScreen.tsx
- Uses ScreenWrapper
- Uses Card
- Uses AppButton
- Uses AppInput
- No hardcoded colors

### Screens to Refactor

1. **SignupScreen.tsx** - Similar to LoginScreen
2. **Dashboard.tsx** - Use Card, SectionHeader, TransactionItem
3. **Transactions.tsx** - Use ScreenWrapper, AppHeader, TransactionItem
4. **BanksScreen.tsx** - Use ScreenWrapper, AppHeader, Card
5. **Add.tsx** - Use ScreenWrapper, Card, AppButton, AppInput
6. **Settings.tsx** - Use ScreenWrapper, AppHeader, Card
7. **ProfileScreen.tsx** - Use ScreenWrapper, AppHeader, AppInput, AppButton
8. **CreditCardsList.tsx** - Use ScreenWrapper, AppHeader, Card
9. **AddCreditCard.tsx** - Use ScreenWrapper, AppHeader, AppInput, AppButton
10. **LoansList.tsx** - Use ScreenWrapper, AppHeader, Card

## Refactoring Pattern

```typescript
// 1. Import components
import { ScreenWrapper, AppHeader, Card, AppButton, AppInput } from '../components';
import { useTheme } from '../context/ThemeContext';

// 2. Get theme values
const { colors, typography, spacing, borderRadius, shadows } = useTheme();

// 3. Replace structure
<ScreenWrapper scrollable keyboardAvoiding>
  <AppHeader title="Screen Title" showBack />
  <View style={{ padding: spacing.lg }}>
    <Card>
      {/* Content */}
    </Card>
  </View>
</ScreenWrapper>

// 4. Replace inputs
<AppInput
  label="Email"
  value={email}
  onChangeText={setEmail}
  icon="email"
  error={emailError}
/>

// 5. Replace buttons
<AppButton
  title="Submit"
  onPress={handleSubmit}
  loading={loading}
  variant="primary"
  fullWidth
/>
```

## Key Rules

1. **NO hardcoded colors** - Always use `colors` from `useTheme()`
2. **NO hardcoded spacing** - Use `spacing` from `useTheme()`
3. **NO hardcoded typography** - Use `typography` from `useTheme()`
4. **NO hardcoded borderRadius** - Use `borderRadius` from `useTheme()`
5. **Use ScreenWrapper** as root component for all screens
6. **Use AppHeader** for consistent headers
7. **Use Card** for all card containers
8. **Use AppButton** for all buttons
9. **Use AppInput** for all text inputs

## Benefits

- ✅ Consistent UI across all screens
- ✅ Easy theme switching (Light/Dark)
- ✅ Reduced code duplication
- ✅ Easier maintenance
- ✅ Better accessibility
- ✅ Professional appearance
