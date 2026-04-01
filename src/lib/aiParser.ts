import { TransactionType } from '../types';

interface ParsedTransaction {
  amount: number;
  note: string;
  type: TransactionType;
  category: string;
}

export async function parseTransactionWithAI(text: string): Promise<ParsedTransaction> {
  return parseTransaction(text);
}

export const parseTransaction = (text: string): ParsedTransaction => {
  const lowerText = text.toLowerCase();
  
  // Extract amount
  const amountMatch = text.match(/₹?\s*(\d+(?:\.\d+)?)/);
  const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;
  
  // Detect type
  let type: TransactionType = 'expense';
  if (/salary|received|credited|income|got|earned|refund|give me|gave|given/.test(lowerText)) {
    type = 'income';
  } else if (/sip|mutual fund|stocks|zerodha|invest|shares|fd|nps/.test(lowerText)) {
    type = 'investment';
  } else if (/emi|loan|equated|hdfc loan|iciciloan/.test(lowerText)) {
    type = 'emi';
  }
  
  // Extract note — remove amount, keep rest
  const note = text.replace(/₹?\s*\d+(?:\.\d+)?/, '').trim() || text.slice(0, 30);
  
  return { amount, type, note, category: type };
};
