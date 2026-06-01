import { TransactionType } from '../types';

export interface ParsedTransaction {
  amount: number | null;
  type: TransactionType | null;
  note: string;
  category: string;
}

// --- DIRECTIONAL PHRASES (checked FIRST, order matters) ---
// "someone gave/give ME" = Income (money coming IN)
const INCOME_PHRASES = [
  'give me', 'gave me', 'gives me', 'given me', 'giving me',
  'diya mujhe', 'mujhe diya', 'mujhe mila', 'mujhe aaya',
  'de do', 'de diya', 'dede', 'mujhe de', 'mere ko diya',
  'sent me', 'transfer kiya mujhe',
];
// "I gave/give SOMEONE" = Expense (money going OUT)
const EXPENSE_PHRASES = [
  'i gave', 'i paid', 'i spent', 'i spend', 'i sent',
  'maine diya', 'mene diya', 'ko diya', 'usko diya', 'usse diya',
  'unko diya', 'diya ko', 'pay kiya', 'bheja ko',
];

// --- SIMPLE KEYWORDS (checked if no phrase matched) ---
const EXPENSE_KEYWORDS = [
  'paid', 'kharcha', 'spent', 'spend', 'sent', 'bought', 'purchase',
  'khareed', 'khareedha', 'pay', 'bheja', 'used', 'cost', 'bill', 'recharge',
];
const INCOME_KEYWORDS = [
  'mila', 'received', 'got', 'aaya', 'salary', 'refund', 'cashback', 'income',
  'earned', 'kamaya', 'credited',
];
// Ambiguous words like "gave", "give", "diya", "liya" are NOT in simple keywords.
// They need directional context (who gave to whom), handled by phrases above.
const LENT_KEYWORDS = ['udhar diya', 'lent'];
const BORROWED_KEYWORDS = ['udhar liya', 'borrowed'];
const REFUND_KEYWORDS = ['refund', 'refunded'];
const PERSONAL_TRANSFER_KEYWORDS = [
  'family', 'friend', 'brother', 'sister', 'bhai', 'dost', 'mom', 'dad', 'papa', 'mummy',
  'cash deposit', 'bank deposit', 'cash withdrawal', 'atm withdrawal', 'withdrawal', 'withdrawn',
  'self transfer', 'own account', 'reimbursement', 'reimburse',
  'loan repayment', 'debt repayment',
];

// Category mapping — keyword -> category label
const CATEGORY_MAP: Record<string, string> = {
  // Transport
  petrol: 'Transport', diesel: 'Transport', fuel: 'Transport', gas: 'Transport',
  uber: 'Transport', ola: 'Transport', auto: 'Transport', cab: 'Transport',
  metro: 'Transport', bus: 'Transport', transport: 'Transport', travel: 'Transport',
  parking: 'Transport', toll: 'Transport',

  // Food
  food: 'Food', khana: 'Food', zomato: 'Food', swiggy: 'Food',
  restaurant: 'Food', pizza: 'Food', burger: 'Food', chai: 'Food',
  coffee: 'Food', lunch: 'Food', dinner: 'Food', breakfast: 'Food',
  nashta: 'Food', snack: 'Food', snacks: 'Food',

  // Shopping
  shopping: 'Shopping', amazon: 'Shopping', flipkart: 'Shopping', myntra: 'Shopping',
  clothes: 'Shopping', kapde: 'Shopping', shoes: 'Shopping', dress: 'Shopping',
  electronics: 'Shopping', phone: 'Shopping', mobile: 'Shopping',

  // Groceries
  grocery: 'Groceries', groceries: 'Groceries', ration: 'Groceries',
  sabzi: 'Groceries', vegetables: 'Groceries', milk: 'Groceries',
  doodh: 'Groceries', fruits: 'Groceries', kirana: 'Groceries',
  blinkit: 'Groceries', zepto: 'Groceries', bigbasket: 'Groceries',
  instamart: 'Groceries',

  // Bills & Recharge
  recharge: 'Bills', bill: 'Bills', bills: 'Bills', electricity: 'Bills',
  bijli: 'Bills', light: 'Bills', wifi: 'Bills', internet: 'Bills',
  broadband: 'Bills', water: 'Bills', paani: 'Bills', gas_bill: 'Bills',

  // Rent
  rent: 'Rent', kiraya: 'Rent',

  // Medical
  medical: 'Medical', medicine: 'Medical', dawai: 'Medical', doctor: 'Medical',
  hospital: 'Medical', clinic: 'Medical', health: 'Medical', pharmacy: 'Medical',

  // Entertainment
  movie: 'Entertainment', movies: 'Entertainment', film: 'Entertainment',
  netflix: 'Entertainment', spotify: 'Entertainment', hotstar: 'Entertainment',
  gaming: 'Entertainment', game: 'Entertainment', subscription: 'Entertainment',

  // Education
  tuition: 'Education', fees: 'Education', books: 'Education', course: 'Education',
  school: 'Education', college: 'Education', coaching: 'Education', class: 'Education',
  padhai: 'Education', exam: 'Education',

  // Salary & Income
  salary: 'Salary', freelance: 'Freelance', cashback: 'Cashback', refund: 'Refund',
  bonus: 'Bonus', interest: 'Interest', dividend: 'Dividend',

  // Investment & EMI
  emi: 'EMI', loan: 'Loan', investment: 'Investment', sip: 'Investment',
  mutual: 'Investment', stock: 'Investment', fd: 'Investment',

  // Gifts & Donations
  gift: 'Gift', donation: 'Donation', charity: 'Donation', daan: 'Donation',

  // Personal care
  salon: 'Personal Care', haircut: 'Personal Care', parlour: 'Personal Care',
  gym: 'Fitness', fitness: 'Fitness', yoga: 'Fitness',
};

export function parseNaturalLanguageTxn(input: string): ParsedTransaction {
  const text = input.toLowerCase().trim();

  let amount: number | null = null;
  let type: TransactionType | null = null;
  let note = '';
  let category = 'Other';

  // 1. Extract Amount
  // Matches "500", "5000", "5k", "2.5k", "₹500", "rs 500"
  const amountRegex = /(?:rs\.?|₹)\s*(\d+(?:\.\d+)?)\s*(k|m)?|\b(\d+(?:\.\d+)?)\s*(k|m)?\b/i;
  const amountMatch = text.match(amountRegex);

  if (amountMatch) {
    const rawValue = amountMatch[1] || amountMatch[3];
    const multiplier = (amountMatch[2] || amountMatch[4] || '').toLowerCase();
    let value = parseFloat(rawValue);

    if (multiplier === 'k') value *= 1000;
    if (multiplier === 'm') value *= 1000000;

    amount = value;
  }

  // 2. Extract Type — Directional phrases FIRST, then keywords
  // Step A: Check multi-word directional phrases (highest priority)
  if (LENT_KEYWORDS.some(k => text.includes(k))) {
    type = 'lent';
  } else if (BORROWED_KEYWORDS.some(k => text.includes(k))) {
    type = 'borrowed';
  } else if (REFUND_KEYWORDS.some(k => text.includes(k))) {
    type = 'refund';
  } else if (PERSONAL_TRANSFER_KEYWORDS.some(k => text.includes(k))) {
    type = 'transfer';
  } else if (INCOME_PHRASES.some(k => text.includes(k))) {
    type = 'income';
  } else if (EXPENSE_PHRASES.some(k => text.includes(k))) {
    type = 'expense';
  }

  // Step B: If no phrase matched, fall back to single-word keywords
  if (!type) {
    if (INCOME_KEYWORDS.some(k => text.includes(k))) {
      type = 'income';
    } else if (EXPENSE_KEYWORDS.some(k => text.includes(k))) {
      type = 'expense';
    }
  }

  // Step C: If still no type but there is an amount, assume expense
  if (!type && amount && text.length > 0) {
    type = 'expense';
  }

  // 3. Smart Category & Note Extraction
  // 4. Category Detection — check every word in the original text against CATEGORY_MAP
  const allWords = text.split(/\s+/);
  for (const word of allWords) {
    const clean = word.replace(/[^a-z0-9]/g, '');
    if (CATEGORY_MAP[clean]) {
      category = CATEGORY_MAP[clean];
      break;
    }
  }

  // 5. Note = original input, title-cased (preserves full context)
  // Remove only the amount portion for a cleaner note
  let noteText = text;
  if (amountMatch) {
    noteText = noteText.replace(amountMatch[0], '').replace(/\s+/g, ' ').trim();
  }
  // Title-case each word
  note = noteText
    .split(' ')
    .filter(w => w.length > 0)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  // Fallback if note ends up empty
  if (!note) {
    note = category !== 'Other' ? category : '';
  }

  return {
    amount,
    type,
    note,
    category,
  };
}
