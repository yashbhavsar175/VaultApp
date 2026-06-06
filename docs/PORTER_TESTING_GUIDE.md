# Porter Distance Calculator - Testing Guide

## 🎯 Quick Testing (Without Real Porter App)

Ab aap **bina Porter app ke** bhi testing kar sakte ho! Developer mode off karke real Porter pe jane ki zaroorat nahi.

### Testing Features:

#### 1️⃣ **Individual Event Testing**
Har trip ke neeche 2 buttons hain:
- **"+ Add Success Event"** - Successful distance calculation simulate karta hai
- **"+ Add Failed Event"** - Failed calculation simulate karta hai (API error)

#### 2️⃣ **Bulk Testing**
- **"🎲 BULK TEST (5x)"** button - Ek click mein 5 random events generate karta hai
- Mix of success and failures (realistic testing)
- History instantly populate ho jati hai

#### 3️⃣ **Event History Panel**
- **Last 50 events** automatically save hote hain
- **Collapsible** - Tap to expand/collapse
- **Color-coded**:
  - 🟢 Green = Success
  - 🔴 Red = Failed/Error
  - 🔵 Blue = Other events
- **Quick Stats** - Success/Failed count at a glance

#### 4️⃣ **Delete Options**
- **Individual Delete** - Har event card mein 🗑️ button
- **Delete All** - Header mein 🗑️ icon (delete all history)
- Instant deletion with toast confirmation

#### 5️⃣ **Export History**
- Export icon (📤) click karo
- Complete history clipboard mein copy ho jati hai
- Share kar sakte ho debugging ke liye

---

## 📱 Testing Workflow

### Step 1: Open Porter Test Screen
```
Dashboard → Porter → Porter Test Screen
```

### Step 2: Generate Test Events
```
Option A: Individual Testing
- Kisi bhi trip ke neeche "Add Success Event" ya "Add Failed Event" dabao
- History mein instantly add ho jayega

Option B: Bulk Testing
- "🎲 BULK TEST (5x)" button dabao
- 5 random events generate honge
```

### Step 3: View History
```
- "Event History" section expand karo
- Har event mein dekho:
  ✓ Pickup/Drop addresses
  ✓ Distance calculation result
  ✓ API status
  ✓ Error messages (if any)
  ✓ Timestamp
```

### Step 4: Delete Events
```
Individual Delete:
- Har event card ke top-right mein 🗑️ icon
- Click karo to delete that event

Delete All:
- History header mein 🗑️ icon (delete-sweep)
- Click karo to delete all history
```

### Step 5: Export & Share
```
- Export icon (📤) click karo
- History clipboard mein copy ho jayegi
- WhatsApp/Email se share kar sakte ho
```

---

## 🔍 What Each Event Shows

```
Event #1 • TYPE_WINDOW_STATE_CHANGED
Time: 6:07 PM

📍 Pickup: Manilal Estate, Ahmedabad
📍 Drop: Swapnil Arcade, Ahmedabad

Result: {"toPickup":"1.2 km","tripDistance":"13.0 km"}
API Status: Success
Status: Success: Overlay shown
```

---

## 🐛 Debugging Real Porter Events

Jab real Porter app use karo:

1. **Accessibility Service Enable** karo
2. Porter app mein order aaye
3. **Automatically history mein save** ho jayega
4. Baad mein Test Screen kholo aur history check karo

**Porter screen block hone ke baad bhi** sab events saved rahenge!

---

## 🎨 Visual Indicators

| Icon/Color | Meaning |
|------------|---------|
| 🟢 Green Border | Successful calculation |
| 🔴 Red Border | Failed calculation |
| ⚪ Gray Border | Skipped/Ignored event |
| 🗑️ (on card) | Delete this event |
| 🗑️ (in header) | Delete all history |
| 📤 | Export history to clipboard |

---

## 💡 Pro Tips

1. **Bulk test first** - 5-10 events generate karo to see how history looks
2. **Mix success/failures** - Realistic testing ke liye
3. **Export regularly** - Important bugs ko document karne ke liye
4. **Check API errors** - Har event mein API status check karo

---

## 🚀 Next Steps

1. ✅ Test without Porter app (using simulate buttons)
2. ✅ Verify history is working
3. ✅ Check export functionality
4. ✅ Then test with real Porter app

---

## 📊 History Limits

- **Maximum 50 events** saved
- Oldest events automatically removed
- Clear button se sab delete kar sakte ho

---

## 🔧 Troubleshooting

**History not showing?**
- "REFRESH" button dabao
- Check if events are being generated

**Export not working?**
- Check clipboard permissions
- Try again after a few seconds

**Events not auto-refreshing?**
- Manually "REFRESH" button dabao
- Check if accessibility service is running

---

## 📝 Sample Export Format

```
Porter Debug History Export
Generated: 13/05/2026, 18:07:13
Total Events: 5
Success: 3
Failed: 2

==================================================

Event #1
Time: 13/05/2026, 18:07:13
Type: TYPE_WINDOW_STATE_CHANGED
Pickup: Satellite, Ahmedabad, Gujarat
Drop: Maninagar, Ahmedabad, Gujarat
Result: {"toPickup":"2.3 km","tripDistance":"8.5 km"}
API Status: Success
Status: Success: Overlay shown

--------------------------------------------------

Event #2
Time: 13/05/2026, 18:06:45
Type: TYPE_WINDOW_STATE_CHANGED
Pickup: Bopal, Ahmedabad, Gujarat
Drop: Navrangpura, Ahmedabad, Gujarat
Result: {"toPickup":"N/A","tripDistance":"N/A"}
API Status: Element status: toPickup=ZERO_RESULTS
Status: Failed: Distance calc returned N/A

--------------------------------------------------
```

---

## ✨ Happy Testing! 🚛
