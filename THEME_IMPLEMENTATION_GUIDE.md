# Theme Implementation Guide for SpendSense

## ✅ Completed
1. **ThemeContext** - Created at `src/context/ThemeContext.tsx`
2. **App.tsx** - Wrapped with ThemeProvider
3. **Settings.tsx** - Added Appearance section with Light/Dark/System toggle
4. **LoginScreen.tsx** - Updated to use theme colors
5. **SignupScreen.tsx** - Partially updated (needs JSX completion)

## 🔄 Pattern for Updating Remaining Screens

### Step 1: Import useTheme
```typescript
import { useTheme } from '../context/ThemeContext';
```

### Step 2: Get colors from theme
```typescript
export default function YourScreen() {
  const { colors } = useTheme();
  // ... rest of component
}
```

### Step 3: Update StyleSheet
Remove hardcoded colors from StyleSheet.create():
```typescript
// BEFORE
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  text: {
    color: '#fff',
  },
});

// AFTER
const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  text: {
    // Remove color property
  },
});
```

### Step 4: Apply colors in JSX
```typescript
// BEFORE
<View style={styles.container}>
  <Text style={styles.text}>Hello</Text>
</View>

// AFTER
<View style={[styles.container, { backgroundColor: colors.background }]}>
  <Text style={[styles.text, { color: colors.text }]}>Hello</Text>
</View>
```

## 📋 Screens to Update

### Priority 1 (Main Screens)
- [ ] **SignupScreen.tsx** - Complete JSX update with theme colors
- [ ] **Dashboard.tsx** - Main dashboard screen
- [ ] **Transactions.tsx** - Transaction list
- [ ] **Add.tsx** - Add transaction screen

### Priority 2 (Feature Screens)
- [ ] **BanksScreen.tsx** - Bank accounts list
- [ ] **LoansScreen.tsx** - Loans list
- [ ] **CreditCardsList.tsx** - Credit cards list
- [ ] **AddCreditCard.tsx** - Add credit card screen
- [ ] **ProfileScreen.tsx** - User profile

## 🎨 Theme Colors Reference

### Dark Theme
```typescript
{
  background: '#0a0a0f',
  card: '#1a1a2e',
  text: '#ffffff',
  subtext: '#888888',
  accent: '#7c3aed',  // Purple - same in both themes
  border: '#2a2a3e',
  input: '#0a0a0f',
  error: '#ff4444',
  success: '#4caf50',
  warning: '#ff9800',
  modalOverlay: 'rgba(0, 0, 0, 0.7)',
}
```

### Light Theme
```typescript
{
  background: '#f5f5f5',
  card: '#ffffff',
  text: '#1a1a1a',
  subtext: '#666666',
  accent: '#7c3aed',  // Purple - same in both themes
  border: '#e0e0e0',
  input: '#f8f8f8',
  error: '#ff4444',
  success: '#4caf50',
  warning: '#ff9800',
  modalOverlay: 'rgba(0, 0, 0, 0.5)',
}
```

## 🔧 Common Patterns

### Container
```typescript
<SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
```

### Card
```typescript
<View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
```

### Text
```typescript
<Text style={[styles.title, { color: colors.text }]}>Title</Text>
<Text style={[styles.subtitle, { color: colors.subtext }]}>Subtitle</Text>
```

### Input
```typescript
<TextInput
  style={[styles.input, { 
    backgroundColor: colors.input, 
    borderColor: colors.border, 
    color: colors.text 
  }]}
  placeholderTextColor={colors.subtext}
/>
```

### Button (Primary)
```typescript
<TouchableOpacity style={[styles.button, { backgroundColor: colors.accent }]}>
  <Text style={styles.buttonText}>Button</Text>
</TouchableOpacity>
```

### Modal
```typescript
<Modal visible={showModal} transparent animationType="fade">
  <View style={[styles.modalOverlay, { backgroundColor: colors.modalOverlay }]}>
    <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.modalTitle, { color: colors.text }]}>Title</Text>
      <Text style={[styles.modalText, { color: colors.subtext }]}>Content</Text>
    </View>
  </View>
</Modal>
```

### Divider
```typescript
<View style={[styles.divider, { backgroundColor: colors.border }]} />
```

## ⚠️ Important Notes

1. **Keep Purple Accent**: The accent color (#7c3aed) stays the same in both themes
2. **Icons**: Icon colors should use `colors.accent` for primary icons, `colors.text` or `colors.subtext` for others
3. **Error/Success**: Use `colors.error` and `colors.success` for status messages
4. **Modals**: Always use `colors.modalOverlay` for the overlay background
5. **Placeholders**: Always use `colors.subtext` for placeholder text
6. **Disabled States**: Create disabled styles that work with both themes

## 🧪 Testing Checklist

For each updated screen:
- [ ] Test in Light mode
- [ ] Test in Dark mode
- [ ] Test in System mode (switch system theme)
- [ ] Check all text is readable
- [ ] Check all inputs are visible
- [ ] Check all buttons are visible
- [ ] Check modals/overlays work correctly
- [ ] Verify no hardcoded colors remain

## 📱 User Experience

- Theme preference is saved in AsyncStorage
- Preference persists across app restarts
- System mode follows device theme automatically
- Theme can be changed in Settings → Appearance
- Changes apply immediately without restart
