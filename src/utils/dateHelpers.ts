export const parseLocalDate = (dateString: string): Date => {
  const [year, month, day] = dateString.split('-').map(Number);
  return new Date(year, month - 1, day);
};

export const formatDateForDisplay = (dateString: string): string => {
  const date = parseLocalDate(dateString);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

export const formatDateForDB = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const getISTDate = (utcDate: string | Date): Date => {
  const date = new Date(utcDate);
  const istOffset = 5.5 * 60 * 60 * 1000;
  return new Date(date.getTime() + istOffset);
};
