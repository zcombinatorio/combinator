/**
 * Mock mode detection and utilities
 *
 * This module provides utilities to detect when the application should run in mock mode
 * (without external API keys or database access) and exports all mock implementations.
 */

// Environment detection functions
export function shouldUseMockData(): boolean {
  // Check if explicitly enabled
  if (process.env.USE_MOCK_DATA === 'true') {
    return true;
  }

  // Check if DB_URL is missing or set to mock URL
  if (!process.env.DB_URL || process.env.DB_URL === 'mock://localhost') {
    return true;
  }

  return false;
}

export function shouldUseMockHelius(): boolean {
  // Check if explicitly enabled
  if (process.env.USE_MOCK_HELIUS === 'true') {
    return true;
  }

  // Check if Helius API key is missing
  if (!process.env.HELIUS_API_KEY || process.env.HELIUS_API_KEY === '') {
    return true;
  }

  return false;
}

export function shouldUseMockBirdeye(): boolean {
  // Check if Birdeye API key is missing
  if (!process.env.BIRDEYE_API_KEY || process.env.BIRDEYE_API_KEY === '') {
    return true;
  }

  return false;
}

export function shouldUseMockPinata(): boolean {
  // Check if Pinata JWT is missing
  if (!process.env.PINATA_JWT || process.env.PINATA_JWT === '') {
    return true;
  }

  return false;
}

export function shouldUseMockPrivy(): boolean {
  // Check if Privy app ID is missing
  if (!process.env.NEXT_PUBLIC_PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID === '') {
    return true;
  }

  return false;
}

export function isInMockMode(): boolean {
  return shouldUseMockData() || shouldUseMockHelius() || shouldUseMockBirdeye();
}

// Re-export all mock implementations
export * from './mockData';
export { mockHelius } from './mockHelius';
export { mockBirdeye } from './mockBirdeye';
export { mockPinata } from './mockPinata';
export { MockDatabase, getMockDatabase } from './mockDatabase';

// Log mock mode status (only on server)
if (typeof window === 'undefined') {
  const mockServices: string[] = [];

  if (shouldUseMockData()) mockServices.push('Database');
  if (shouldUseMockHelius()) mockServices.push('Helius');
  if (shouldUseMockBirdeye()) mockServices.push('Birdeye');
  if (shouldUseMockPinata()) mockServices.push('Pinata');
  if (shouldUseMockPrivy()) mockServices.push('Privy');

  if (mockServices.length > 0) {
    console.log('\n🔧 Mock Mode Active');
    console.log('═══════════════════════════════════════');
    console.log('Running with mock data for:', mockServices.join(', '));
    console.log('No external API keys or database required!');
    console.log('═══════════════════════════════════════\n');
  }
}
