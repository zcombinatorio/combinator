/**
 * Mock Birdeye API
 * Provides mock market data when Birdeye API key is not available
 */

import { MOCK_MARKET_DATA, MOCK_TOKENS } from './mockData';

class MockBirdeyeAPI {
  /**
   * Get market data for a token
   */
  async getTokenMarketData(tokenAddress: string): Promise<{
    success: boolean;
    data: {
      price: number;
      liquidity: number;
      total_supply: number;
      circulating_supply: number;
      fdv: number;
      market_cap: number;
    } | null;
  }> {
    // Check if we have mock data for this token
    const marketData = MOCK_MARKET_DATA[tokenAddress];

    if (!marketData) {
      // Generate random market data for unknown tokens
      const token = MOCK_TOKENS.find((t) => t.token_address === tokenAddress);

      if (!token) {
        return {
          success: false,
          data: null,
        };
      }

      // Generate realistic random values
      const price = Math.random() * 0.05 + 0.001; // $0.001 - $0.051
      const totalSupply = 100000000;
      const circulatingSupply = totalSupply * (0.7 + Math.random() * 0.25); // 70-95%
      const liquidity = Math.random() * 500000 + 50000; // $50K - $550K
      const fdv = price * totalSupply;
      const marketCap = price * circulatingSupply;

      return {
        success: true,
        data: {
          price: parseFloat(price.toFixed(6)),
          liquidity: parseFloat(liquidity.toFixed(2)),
          total_supply: totalSupply,
          circulating_supply: Math.floor(circulatingSupply),
          fdv: parseFloat(fdv.toFixed(2)),
          market_cap: parseFloat(marketCap.toFixed(2)),
        },
      };
    }

    // Add some randomness to simulate price changes
    const priceVariation = 1 + (Math.random() - 0.5) * 0.05; // +/- 2.5%
    const price = marketData.price * priceVariation;
    const marketCap = (marketData.market_cap / marketData.price) * price;
    const fdv = (marketData.fdv / marketData.price) * price;

    return {
      success: true,
      data: {
        price: parseFloat(price.toFixed(6)),
        liquidity: marketData.liquidity,
        total_supply: marketData.total_supply,
        circulating_supply: marketData.circulating_supply,
        fdv: parseFloat(fdv.toFixed(2)),
        market_cap: parseFloat(marketCap.toFixed(2)),
      },
    };
  }

  /**
   * Get price history for a token (stub for future implementation)
   */
  async getTokenPriceHistory(
    tokenAddress: string,
    timeframe: string = '24h'
  ): Promise<{
    success: boolean;
    data: Array<{ timestamp: number; price: number }>;
  }> {
    const marketData = await this.getTokenMarketData(tokenAddress);

    if (!marketData.success || !marketData.data) {
      return {
        success: false,
        data: [],
      };
    }

    // Generate mock price history
    const now = Date.now();
    const hours = timeframe === '24h' ? 24 : timeframe === '7d' ? 168 : 1;
    const points: Array<{ timestamp: number; price: number }> = [];
    const basePrice = marketData.data.price;

    for (let i = hours; i >= 0; i--) {
      const timestamp = now - i * 3600000;
      const variation = 1 + (Math.random() - 0.5) * 0.1; // +/- 5%
      const price = basePrice * variation;
      points.push({
        timestamp,
        price: parseFloat(price.toFixed(6)),
      });
    }

    return {
      success: true,
      data: points,
    };
  }

  /**
   * Get token overview (combines multiple data points)
   */
  async getTokenOverview(tokenAddress: string): Promise<{
    success: boolean;
    data: any;
  }> {
    const marketData = await this.getTokenMarketData(tokenAddress);
    const token = MOCK_TOKENS.find((t) => t.token_address === tokenAddress);

    if (!marketData.success || !marketData.data || !token) {
      return {
        success: false,
        data: null,
      };
    }

    return {
      success: true,
      data: {
        address: tokenAddress,
        name: token.token_name,
        symbol: token.token_symbol,
        ...marketData.data,
        // Additional mock fields
        volume24h: marketData.data.liquidity * (0.1 + Math.random() * 0.5),
        priceChange24h: (Math.random() - 0.5) * 20, // +/- 10%
        holders: Math.floor(Math.random() * 1000) + 100,
        decimals: 9,
      },
    };
  }
}

// Export singleton instance
export const mockBirdeye = new MockBirdeyeAPI();
