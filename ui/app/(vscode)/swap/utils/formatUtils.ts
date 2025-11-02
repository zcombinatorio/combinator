/**
 * Format a balance with K/M/B suffixes for large numbers
 * @example formatBalance('1234567') // returns '1.23M'
 * @example formatBalance('123') // returns '123'
 */
export function formatBalance(balance: string): string {
  const bal = parseFloat(balance);
  if (isNaN(bal)) return '0';

  if (bal >= 1000000000) {
    return (bal / 1000000000).toFixed(2).replace(/\.?0+$/, '') + 'B';
  }
  if (bal >= 1000000) {
    return (bal / 1000000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  }
  if (bal >= 1000) {
    return (bal / 1000).toFixed(2).replace(/\.?0+$/, '') + 'K';
  }

  return parseFloat(bal.toFixed(4)).toString();
}
