# 🧭 Navigation Setup Guide

## Adding New Screens to Navigation

Aapke naye screens ko navigation mein add karne ke liye:

### Option 1: Dashboard Stack mein Add karo

import { BankConfigScreen, SMSTestScreen } from '../screens/AllScreens';

// Add to stack
<Stack.Screen 
  name="BankConfigScreen" 
  component={BankConfigScreen}
  options={{ title: 'Bank Setup' }}
/>

<Stack.Screen 
  name="SMSTestScreen" 
  component={SMSTestScreen}
  options={{ title: 'SMS Parser Test' }}
/>
```

### Option 2: Settings Screen se Link karo

```typescript
// In your Settings/Profile screen

<TouchableOpacity 
  onPress={() => navigation.navigate('BankConfigScreen')}
  style={styles.settingItem}>
  <MaterialCommunityIcons name="bank" size={24} color={colors.accent} />
  <Text style={styles.settingText}>Bank Setup</Text>
  <MaterialCommunityIcons name="chevron-right" size={24} color={colors.subtext} />
</TouchableOpacity>

<TouchableOpacity 
  onPress={() => navigation.navigate('SMSTestScreen')}
  style={styles.settingItem}>
  <MaterialCommunityIcons name="message-text" size={24} color={colors.accent} />
  <Text style={styles.settingText}>SMS Parser Test</Text>
  <MaterialCommunityIcons name="chevron-right" size={24} color={colors.subtext} />
</TouchableOpacity>
```

### Option 3: Dashboard pe Quick Access Button

```typescript
// In Dashboard.tsx

<View style={styles.quickActions}>
  <TouchableOpacity 
    onPress={() => navigation.navigate('BankConfigScreen')}
    style={styles.quickActionButton}>
    <MaterialCommunityIcons name="bank-plus" size={32} color={colors.accent} />
    <Text style={styles.quickActionText}>Setup Banks</Text>
  </TouchableOpacity>
  
  <TouchableOpacity 
    onPress={() => navigation.navigate('SMSTestScreen')}
    style={styles.quickActionButton}>
    <MaterialCommunityIcons name="test-tube" size={32} color={colors.accent} />
    <Text style={styles.quickActionText}>Test SMS</Text>
  </TouchableOpacity>
</View>
```

---

## 🎯 Recommended Setup

### For Production Users:
```
Dashboard
  ↓
Settings/Profile
  ↓
"Bank Setup" option
  ↓
BankConfigScreen
```

### For Testing/Development:
```
Dashboard
  ↓
Developer Menu (hidden/debug)
  ↓
"SMS Parser Test"
  ↓
SMSTestScreen
```

---

## 📱 Complete Navigation Example

```typescript
// src/navigation/DashboardStack.tsx

import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import {
  Dashboard,
  BanksScreen,
  BankConfigScreen,
  SMSTestScreen,
  // ... other screens
} from '../screens/AllScreens';

const Stack = createStackNavigator();

export default function DashboardStack() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
      }}>
      <Stack.Screen name="Dashboard" component={Dashboard} />
      <Stack.Screen name="BanksScreen" component={BanksScreen} />
      
      {/* New Screens */}
      <Stack.Screen 
        name="BankConfigScreen" 
        component={BankConfigScreen}
        options={{ 
          title: 'Bank Setup',
          headerShown: true,
        }}
      />
      
      <Stack.Screen 
        name="SMSTestScreen" 
        component={SMSTestScreen}
        options={{ 
          title: 'SMS Parser Test',
          headerShown: true,
        }}
      />
    </Stack.Navigator>
  );
}
```

---

## 🔗 TypeScript Navigation Types

```typescript
// src/types/navigation.ts

export type DashboardStackParamList = {
  Dashboard: undefined;
  BanksScreen: undefined;
  BankConfigScreen: undefined;
  SMSTestScreen: undefined;
  // ... other screens
};

// Usage in components
import { NavigationProp } from '@react-navigation/native';
import { DashboardStackParamList } from '../types/navigation';

type Props = {
  navigation: NavigationProp<DashboardStackParamList>;
};

export default function MyScreen({ navigation }: Props) {
  const goToBankSetup = () => {
    navigation.navigate('BankConfigScreen');
  };
  
  return (
    <TouchableOpacity onPress={goToBankSetup}>
      <Text>Setup Banks</Text>
    </TouchableOpacity>
  );
}
```

---

## 🎨 UI Integration Examples

### 1. Settings Screen Integration

```typescript
// In ProfileScreen.tsx or SettingsScreen.tsx

const settingsOptions = [
  {
    id: 'bank-setup',
    title: 'Bank & Card Setup',
    subtitle: 'Manage your accounts',
    icon: 'bank',
    onPress: () => navigation.navigate('BankConfigScreen'),
  },
  {
    id: 'sms-test',
    title: 'SMS Parser Test',
    subtitle: 'Test transaction detection',
    icon: 'message-text',
    onPress: () => navigation.navigate('SMSTestScreen'),
    isDeveloper: true, // Only show in dev mode
  },
  // ... other options
];

return (
  <ScrollView>
    {settingsOptions.map(option => (
      !option.isDeveloper || __DEV__ ? (
        <TouchableOpacity 
          key={option.id}
          onPress={option.onPress}
          style={styles.settingItem}>
          <MaterialCommunityIcons 
            name={option.icon} 
            size={24} 
            color={colors.accent} 
          />
          <View style={styles.settingContent}>
            <Text style={styles.settingTitle}>{option.title}</Text>
            <Text style={styles.settingSubtitle}>{option.subtitle}</Text>
          </View>
          <MaterialCommunityIcons 
            name="chevron-right" 
            size={24} 
            color={colors.subtext} 
          />
        </TouchableOpacity>
      ) : null
    ))}
  </ScrollView>
);
```

### 2. Dashboard Quick Actions

```typescript
// In Dashboard.tsx

<View style={styles.quickActionsSection}>
  <Text style={styles.sectionTitle}>Quick Actions</Text>
  
  <View style={styles.quickActionsGrid}>
    <TouchableOpacity 
      style={styles.quickActionCard}
      onPress={() => navigation.navigate('BankConfigScreen')}>
      <View style={[styles.iconCircle, { backgroundColor: colors.accent + '20' }]}>
        <MaterialCommunityIcons name="bank-plus" size={28} color={colors.accent} />
      </View>
      <Text style={styles.quickActionTitle}>Setup Banks</Text>
      <Text style={styles.quickActionSubtitle}>Add accounts</Text>
    </TouchableOpacity>
    
    {__DEV__ && (
      <TouchableOpacity 
        style={styles.quickActionCard}
        onPress={() => navigation.navigate('SMSTestScreen')}>
        <View style={[styles.iconCircle, { backgroundColor: '#10b981' + '20' }]}>
          <MaterialCommunityIcons name="test-tube" size={28} color="#10b981" />
        </View>
        <Text style={styles.quickActionTitle}>Test SMS</Text>
        <Text style={styles.quickActionSubtitle}>Debug parser</Text>
      </TouchableOpacity>
    )}
  </View>
</View>
```

### 3. First-Time Setup Flow

```typescript
// In App.tsx or onboarding flow

const [hasSetupBanks, setHasSetupBanks] = useState(false);

useEffect(() => {
  checkBankSetup();
}, []);

const checkBankSetup = async () => {
  const accounts = await getBankAccounts();
  if (accounts.length === 0) {
    // Show setup prompt
    Alert.alert(
      'Setup Your Banks',
      'Add your bank accounts to enable automatic transaction detection from SMS.',
      [
        { text: 'Later', style: 'cancel' },
        { 
          text: 'Setup Now', 
          onPress: () => navigation.navigate('BankConfigScreen')
        },
      ]
    );
  }
};
```

---

## 🚀 Quick Start Commands

### 1. Add to Navigation
```bash
# Open navigation file
code src/navigation/DashboardStack.tsx

# Add imports and screens (see examples above)
```

### 2. Test Navigation
```bash
# Run app
npm start

# Or
npx react-native run-android
```

### 3. Verify Screens
```
1. Open app
2. Navigate to Settings/Profile
3. Look for "Bank Setup" option
4. Tap to open BankConfigScreen
5. Test adding a bank
```

---

## ✅ Checklist

- [ ] Import screens in navigation file
- [ ] Add Stack.Screen components
- [ ] Add TypeScript types (if using)
- [ ] Add UI buttons/links to navigate
- [ ] Test navigation flow
- [ ] Test back button
- [ ] Test deep linking (if needed)
- [ ] Add to Settings/Profile menu
- [ ] Test on both Android and iOS

---

## 🎯 Best Practices

### 1. User Discovery
```
✅ Add to Settings menu (easy to find)
✅ Show onboarding prompt for first-time users
✅ Add quick action on Dashboard
❌ Don't hide in deep menus
```

### 2. Developer Tools
```
✅ SMS Test screen only in __DEV__ mode
✅ Or behind a "Developer Options" toggle
❌ Don't show to production users
```

### 3. Navigation Flow
```
✅ Clear back button
✅ Proper screen titles
✅ Consistent navigation patterns
❌ Don't create navigation loops
```

---

## 📝 Summary

**Minimum Required:**
1. Add screens to navigation stack
2. Add link in Settings/Profile
3. Test navigation

**Recommended:**
1. Add quick action on Dashboard
2. Show first-time setup prompt
3. Add developer menu for SMS test
4. Add TypeScript types

**That's it!** Your screens are now accessible to users. 🎉
