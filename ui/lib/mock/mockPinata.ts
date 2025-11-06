/**
 * Mock Pinata IPFS API
 * Provides mock IPFS upload functionality when Pinata JWT is not available
 */

import { MOCK_TOKEN_METADATA } from './mockData';

class MockPinataAPI {
  private uploadCounter = 0;
  private metadataStore = new Map<string, any>();

  constructor() {
    // Pre-populate with mock metadata
    Object.entries(MOCK_TOKEN_METADATA).forEach(([hash, metadata]) => {
      this.metadataStore.set(hash, metadata);
    });
  }

  /**
   * Mock image upload to IPFS
   * Always returns URL pointing to /z-pfp.jpg
   */
  async uploadImage(file: File | Blob): Promise<{ url: string; hash: string }> {
    this.uploadCounter++;
    const hash = `QmMockHash${this.uploadCounter}_${Date.now()}`;
    const url = `https://mock-ipfs.pinata.cloud/ipfs/${hash}`;

    console.log(`📦 Mock IPFS Upload: ${file instanceof File ? file.name : 'blob'} -> ${hash}`);

    return {
      url,
      hash,
    };
  }

  /**
   * Mock metadata upload to IPFS
   */
  async uploadMetadata(metadata: {
    name: string;
    symbol: string;
    description?: string;
    image: string;
    external_url?: string;
    attributes?: any[];
    properties?: any;
  }): Promise<{ url: string; hash: string }> {
    this.uploadCounter++;
    const hash = `QmMockHash${this.uploadCounter}_${Date.now()}`;
    const url = `https://mock-ipfs.pinata.cloud/ipfs/${hash}`;

    // Store metadata for later retrieval
    this.metadataStore.set(hash, {
      ...metadata,
      // Ensure image points to local z-pfp.jpg
      image: '/z-pfp.jpg',
      properties: {
        ...metadata.properties,
        files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
        category: 'image',
      },
    });

    console.log(`📦 Mock IPFS Upload: ${metadata.name} metadata -> ${hash}`);

    return {
      url,
      hash,
    };
  }

  /**
   * Mock file upload (generic)
   */
  async uploadFile(
    file: File | Blob,
    options?: { name?: string }
  ): Promise<{ IpfsHash: string; PinSize: number; Timestamp: string }> {
    this.uploadCounter++;
    const hash = `QmMockHash${this.uploadCounter}_${Date.now()}`;

    console.log(`📦 Mock IPFS Upload: ${options?.name || 'file'} -> ${hash}`);

    return {
      IpfsHash: hash,
      PinSize: file.size || 1024,
      Timestamp: new Date().toISOString(),
    };
  }

  /**
   * Mock JSON upload
   */
  async uploadJSON(json: any, options?: { name?: string }): Promise<{
    IpfsHash: string;
    PinSize: number;
    Timestamp: string;
  }> {
    this.uploadCounter++;
    const hash = `QmMockHash${this.uploadCounter}_${Date.now()}`;

    // Store metadata
    this.metadataStore.set(hash, json);

    console.log(`📦 Mock IPFS Upload: ${options?.name || 'JSON'} -> ${hash}`);

    const jsonString = JSON.stringify(json);

    return {
      IpfsHash: hash,
      PinSize: jsonString.length,
      Timestamp: new Date().toISOString(),
    };
  }

  /**
   * Get metadata by hash (for mock IPFS gateway requests)
   */
  getMetadata(hash: string): any | null {
    return this.metadataStore.get(hash) || null;
  }

  /**
   * Get gateway URL for a hash
   */
  getGatewayUrl(hash: string): string {
    return `https://mock-ipfs.pinata.cloud/ipfs/${hash}`;
  }

  /**
   * Test authentication (always succeeds in mock mode)
   */
  async testAuthentication(): Promise<boolean> {
    return true;
  }
}

// Export singleton instance
export const mockPinata = new MockPinataAPI();

/**
 * Helper function to intercept IPFS metadata fetches
 */
export function getMockIPFSMetadata(url: string): any | null {
  // Extract hash from URL
  const hashMatch = url.match(/\/ipfs\/([^\/]+)/);
  if (!hashMatch) return null;

  const hash = hashMatch[1];

  // Return mock metadata
  const metadata = mockPinata.getMetadata(hash);

  // If metadata exists, return it
  if (metadata) {
    return metadata;
  }

  // Otherwise return default metadata with z-pfp.jpg
  return {
    name: 'Mock Token',
    symbol: 'MOCK',
    description: 'Mock token metadata',
    image: '/z-pfp.jpg',
    properties: {
      files: [{ uri: '/z-pfp.jpg', type: 'image/jpeg' }],
      category: 'image',
    },
  };
}
