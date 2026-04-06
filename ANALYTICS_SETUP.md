# Analytics Screen Setup Guide

## Installation Required

The Analytics screen uses `react-native-chart-kit` for beautiful charts. Install the required packages:

```bash
npm install react-native-chart-kit react-native-svg
```

## What's Included

### New Files Created:
1. `src/screens/AnalyticsScreen.tsx` - Complete analytics screen with charts

### Modified Files:
1. `src/navigation/DashboardStack.tsx` - Added Analytics route
2. `src/screens/Dashboard.tsx` - Added Analytics icon in header
3. `src/components/layout/AppHeader.tsx` - Added support for multiple right actions

## Features

### 1. Time Range Selector
- Week | Month | 3 Months | Year
- Default: Month
- Refreshes all charts when changed

### 2. Summary Cards
- Total Spent (red border)
- Total Income (green border)
- Net Savings (purple border)

### 3. Pie Chart - "Where your money goes"
- Donut chart showing expense breakdown by category
- Color-coded slices
- Legend with amounts and percentages
- Empty state if no data

### 4. Bar Chart - "Daily spending trend"
- Shows last 7 days for week view
- Red bars: Expenses
- Green bars: Income
- Scrollable horizontally
- Empty state if no data

### 5. Top Categories List
- Ranked 1-5
- Colored rank badges
- Progress bars showing % of total
- Amount on right

## Navigation

Access Analytics from:
- Dashboard header → Chart icon (📊)
- Navigates to Analytics screen with back button

## Data Logic

- Fetches transactions using `getTransactions()`
- Filters by selected time range
- Groups by category for pie chart
- Groups by date for bar chart
- Empty categories labeled as "Uncategorized"
- Only 'expense' type for spending charts
- Only 'income' type for income data

## Theme Support

- Uses `useTheme()` for all colors
- Fully supports Light + Dark mode
- Chart colors adapt to theme
- Consistent with app design

## Testing

1. Add some transactions with different categories
2. Navigate to Analytics from Dashboard
3. Try different time ranges
4. Check charts update correctly
5. Test in both light and dark mode

## Troubleshooting

If charts don't show:
1. Make sure packages are installed: `npm install react-native-chart-kit react-native-svg`
2. For iOS: `cd ios && pod install && cd ..`
3. Rebuild the app: `npm run android` or `npm run ios`
4. Check console for errors

If "No Data" appears:
- Add transactions with categories
- Make sure transactions are within selected time range
- Check transaction types (expense/income)
