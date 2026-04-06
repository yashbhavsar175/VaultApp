# Navigation Restructure - Visual Guide

## Bottom Navigation Comparison

### BEFORE (6 tabs - Cluttered)

```
┌──────┬──────┬──────┬──────┬──────┬──────┐
│  🏠  │  📋  │  🏦  │  👥  │  ➕  │  ⚙️  │
│ Dash │Trans │Banks │Peopl │ Add  │ Sett │
└──────┴──────┴──────┴──────┴──────┴──────┘
```

### AFTER (5 tabs - Clean)

```
┌──────┬──────┬──────┬──────┬──────┐
│  🏠  │  📜  │  ➕  │  👥  │  ⚙️  │
│ Dash │Histo │ Add  │Peopl │ Sett │
└──────┴──────┴──────┴──────┴──────┘
              ↑
         Larger & Purple
```

---

## Tab Changes Detail

### 1. Dashboard Tab
```
Icon: view-dashboard (🏠)
Position: 1st
Change: None
Status: ✅ Same
```

### 2. History Tab (Renamed from Transactions)
```
Icon: history (📜) - Changed from format-list-bulleted
Position: 2nd
Change: Renamed, new icon
Status: ✅ Updated
```

### 3. Add Tab (Enhanced)
```
Icon: plus-circle (➕)
Position: 3rd (center)
Size: 32px (was 24px)
Color: Always purple (was dynamic)
Change: Larger, always prominent
Status: ✅ Enhanced
```

### 4. People Tab
```
Icon: account-group (👥)
Position: 4th
Change: None
Status: ✅ Same
```

### 5. Settings Tab
```
Icon: cog (⚙️)
Position: 5th
Change: None
Status: ✅ Same
```

### 6. Banks Tab
```
Status: ❌ REMOVED
New Location: Dashboard → My Banks section
Access: "View All" button
```

---

## Dashboard Layout Changes

### My Banks Section (NEW)

```
┌─────────────────────────────────────┐
│ My Banks                [View All]  │ ← Section header
├─────────────────────────────────────┤
│ ← Scroll horizontally →             │
│                                     │
│ ┌────────┐ ┌────────┐ ┌────────┐  │
│ │   H    │ │   I    │ │   K    │  │ ← Colored circles
│ │  HDFC  │ │  ICICI │ │ Kotak  │  │ ← Bank names
│ │ ••1234 │ │ ••5678 │ │ ••9012 │  │ ← Last 4 digits
│ │        │ │        │ │        │  │
│ │ ₹5,000 │ │₹10,000 │ │ ₹2,000 │  │ ← Balances
│ └────────┘ └────────┘ └────────┘  │
│                                     │
│ Total Balance: ₹17,000              │ ← Summary
└─────────────────────────────────────┘
```

### Empty State (No Banks)

```
┌─────────────────────────────────────┐
│ My Banks                            │
├─────────────────────────────────────┤
│                                     │
│         🏦                          │ ← bank-plus icon
│                                     │
│      Add Bank →                     │ ← Tap to add
│                                     │
└─────────────────────────────────────┘
```

---

## Bank Card Design

### Individual Bank Card

```
┌─────────────────┐
│ ⭕ HDFC Bank    │ ← Circle: getBankColor()
│    ••1234       │ ← Last 4 digits
│                 │
│ ₹5,000          │ ← Green if positive
└─────────────────┘    Red if negative

Width: 160px
Height: Auto
Padding: 16px
Margin Right: 12px
```

### Bank Circle Colors

```
HDFC Bank    → #FF6B6B (Red)
ICICI Bank   → #4ECDC4 (Teal)
Kotak Bank   → #45B7D1 (Blue)
SBI          → #FFA07A (Orange)
Axis Bank    → #98D8C8 (Mint)
Other        → #F7DC6F (Yellow)
```

---

## Navigation Flow Diagrams

### Flow 1: Dashboard → Banks

```
Dashboard
    ↓
[Tap "View All" in My Banks]
    ↓
BanksScreen
    ↓
[Back button]
    ↓
Dashboard
```

### Flow 2: Dashboard → Add Bank

```
Dashboard (No Banks)
    ↓
[Tap "Add Bank →"]
    ↓
BanksScreen
    ↓
[Add new bank]
    ↓
Dashboard (Shows bank)
```

### Flow 3: Bottom Tab Navigation

```
Dashboard ←→ History ←→ Add ←→ People ←→ Settings
    ↓
[Tap "View All"]
    ↓
BanksScreen
    ↓
[Back]
    ↓
Dashboard
```

---

## Add Tab Prominence

### Visual Comparison

**Before:**
```
┌─────┬─────┬─────┬─────┬─────┬─────┐
│ 🏠  │ 📋  │ 🏦  │ 👥  │  ➕ │ ⚙️  │
│     │     │     │     │ 24px│     │
└─────┴─────┴─────┴─────┴─────┴─────┘
                          ↑
                    Same size as others
                    Color changes
```

**After:**
```
┌─────┬─────┬─────┬─────┬─────┐
│ 🏠  │ 📜  │  ➕ │ 👥  │ ⚙️  │
│     │     │ 32px│     │     │
└─────┴─────┴─────┴─────┴─────┘
              ↑
        Larger icon
        Always purple
        Center position
```

---

## Screen Hierarchy

```
App
├── Login/Signup
├── Profile Setup
└── Main App (Bottom Tabs)
    ├── Dashboard Tab
    │   ├── Dashboard Screen
    │   └── Banks Screen (Stack)
    ├── History Tab
    │   └── Transactions Screen
    ├── Add Tab
    │   └── Add Screen
    ├── People Tab
    │   └── People Screen
    └── Settings Tab
        └── Settings Screen
```

---

## Responsive Behavior

### Bank Cards on Small Screens

```
┌──────────────────┐
│ ← Scroll →       │
│ ┌────┐ ┌────┐   │ ← Only 2 visible
│ │ H  │ │ I  │   │
│ │HDFC│ │ICIC│   │
│ └────┘ └────┘   │
└──────────────────┘
```

### Bank Cards on Large Screens

```
┌────────────────────────────┐
│ ← Scroll →                 │
│ ┌────┐ ┌────┐ ┌────┐      │ ← All 3 visible
│ │ H  │ │ I  │ │ K  │      │
│ │HDFC│ │ICIC│ │Kota│      │
│ └────┘ └────┘ └────┘      │
└────────────────────────────┘
```

---

## Color Scheme

### Light Mode

```
Background: #FFFFFF
Card: #F5F5F5
Text: #000000
Subtext: #666666
Border: #E0E0E0
Accent: #7c6af7 (Purple)
Success: #10b981 (Green)
Danger: #ef4444 (Red)
```

### Dark Mode

```
Background: #0a0a0f
Card: #1a1a24
Text: #FFFFFF
Subtext: #999999
Border: #2a2a3a
Accent: #7c6af7 (Purple)
Success: #10b981 (Green)
Danger: #ef4444 (Red)
```

---

## Interaction States

### Tab Bar

```
Active Tab:
- Icon color: Accent purple
- Label color: Accent purple
- Font weight: 600

Inactive Tab:
- Icon color: Subtext gray
- Label color: Subtext gray
- Font weight: 400

Add Tab (Special):
- Icon color: Always accent purple
- Icon size: 32px (larger)
- Label color: Accent purple when active
```

### Bank Cards

```
Default:
- Background: Card color
- Border: None
- Shadow: Subtle

Pressed:
- Opacity: 0.7
- Scale: 0.98
- Feedback: Haptic (if available)
```

---

## Accessibility

### Tab Bar

- All tabs have labels
- Icons have proper contrast
- Touch targets: 60px height
- Keyboard navigation supported

### Bank Cards

- Tap targets: 160x100px minimum
- Color contrast: WCAG AA compliant
- Screen reader labels provided
- Swipe gestures for scroll

---

## Animation Timing

```
Tab Switch: 200ms ease-in-out
Screen Transition: 300ms ease-in-out
Bank Card Scroll: Smooth (native)
Add Tab Pulse: None (always visible)
```

---

## Summary

**Visual Changes:**
- ✅ 5 tabs instead of 6
- ✅ Add tab larger and purple
- ✅ History icon changed
- ✅ Banks section on Dashboard
- ✅ Horizontal scroll for banks
- ✅ Colored bank initials
- ✅ Clean, modern layout

**User Experience:**
- ✅ Less cluttered navigation
- ✅ Prominent Add button
- ✅ Quick bank overview
- ✅ Easy access to all features
- ✅ Intuitive flow

---

**The navigation is now cleaner, more intuitive, and visually appealing!** 🎉
