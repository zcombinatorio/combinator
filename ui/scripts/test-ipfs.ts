#!/usr/bin/env npx ts-node
/**
 * Test script for Kubo IPFS integration
 *
 * Usage:
 *   IPFS_API_URL=https://web.hm.sivalik.com/cmb/ipfs \
 *   IPFS_BASIC_AUTH=cmb:password \
 *   npx ts-node scripts/test-ipfs.ts
 */

// ============================================================================
// Environment Configuration
// ============================================================================

const IPFS_API_URL = process.env.IPFS_API_URL;
const IPFS_BASIC_AUTH = process.env.IPFS_BASIC_AUTH;

if (!IPFS_API_URL || !IPFS_BASIC_AUTH) {
  console.error('Missing required environment variables:');
  console.error('  IPFS_API_URL     - Kubo API base URL (e.g., https://web.hm.sivalik.com/cmb/ipfs)');
  console.error('  IPFS_BASIC_AUTH  - Basic auth credentials (e.g., user:password)');
  process.exit(1);
}

// ============================================================================
// Types (matching lib/ipfs.ts)
// ============================================================================

interface KuboAddResponse {
  Name: string;
  Hash: string;
  Size: string;
}

interface ProposalMetadata {
  title: string;
  description: string;
  options: string[];
  dao_pda: string;
  created_at: string;
}

// ============================================================================
// IPFS Functions (matching lib/ipfs.ts logic)
// ============================================================================

/**
 * Get Basic Auth header value for Kubo
 * Matches: lib/ipfs.ts getKuboAuthHeader()
 */
function getKuboAuthHeader(): string {
  const auth = IPFS_BASIC_AUTH || '';
  return 'Basic ' + Buffer.from(auth).toString('base64');
}

/**
 * Upload JSON metadata to IPFS via Kubo RPC API
 * Matches: lib/ipfs.ts uploadToKubo()
 */
async function uploadToKubo(
  content: object,
  _name?: string
): Promise<string> {
  const jsonData = JSON.stringify(content);

  // Kubo /api/v0/add expects multipart form-data
  const formData = new FormData();
  const blob = new Blob([jsonData], { type: 'application/json' });
  formData.append('file', blob);

  const response = await fetch(`${IPFS_API_URL}/api/v0/add`, {
    method: 'POST',
    headers: {
      'Authorization': getKuboAuthHeader(),
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Kubo IPFS upload failed: ${response.status} - ${errorText}`);
  }

  const data: KuboAddResponse = await response.json();
  return data.Hash;
}

/**
 * Fetch content from IPFS by CID via Kubo RPC API
 * Matches: lib/ipfs.ts fetchFromIPFS() Kubo branch
 */
async function fetchFromKubo<T = unknown>(cid: string): Promise<T> {
  const response = await fetch(`${IPFS_API_URL}/api/v0/cat?arg=${cid}`, {
    method: 'POST',
    headers: {
      'Authorization': getKuboAuthHeader(),
    },
  });

  if (!response.ok) {
    throw new Error(`Kubo IPFS fetch failed: ${response.status}`);
  }

  return response.json();
}

/**
 * Upload proposal metadata to IPFS
 * Matches: lib/ipfs.ts uploadProposalMetadata()
 */
async function uploadProposalMetadata(
  title: string,
  description: string,
  options: string[],
  dao_pda: string
): Promise<string> {
  const metadata: ProposalMetadata = {
    title,
    description,
    options,
    dao_pda,
    created_at: new Date().toISOString(),
  };

  return uploadToKubo(metadata, `proposal-${Date.now()}.json`);
}

// ============================================================================
// Test Runner
// ============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('IPFS Kubo Integration Test');
  console.log('='.repeat(60));
  console.log(`API URL: ${IPFS_API_URL}`);
  console.log(`Auth:    ${IPFS_BASIC_AUTH?.replace(/:.*/, ':****')}`);
  console.log('');

  // Test metadata matching proposal structure
  const testMetadata: Omit<ProposalMetadata, 'created_at'> = {
    title: 'Test Proposal',
    description: 'This is a test proposal to verify IPFS integration works correctly.',
    options: ['Pass', 'Fail'],
    dao_pda: 'TestDAO1111111111111111111111111111111111111',
  };

  console.log('Test Metadata:');
  console.log(JSON.stringify(testMetadata, null, 2));
  console.log('');

  // Upload
  console.log('-'.repeat(60));
  console.log('Uploading to IPFS...');
  const uploadStart = performance.now();

  let cid: string;
  try {
    cid = await uploadProposalMetadata(
      testMetadata.title,
      testMetadata.description,
      testMetadata.options,
      testMetadata.dao_pda
    );
  } catch (error) {
    console.error('Upload failed:', error);
    process.exit(1);
  }

  const uploadTime = performance.now() - uploadStart;
  console.log(`CID:     ${cid}`);
  console.log(`Time:    ${uploadTime.toFixed(2)}ms`);
  console.log('');

  // Fetch
  console.log('-'.repeat(60));
  console.log('Fetching from IPFS...');
  const fetchStart = performance.now();

  let fetchedMetadata: ProposalMetadata;
  try {
    fetchedMetadata = await fetchFromKubo<ProposalMetadata>(cid);
  } catch (error) {
    console.error('Fetch failed:', error);
    process.exit(1);
  }

  const fetchTime = performance.now() - fetchStart;
  console.log('Fetched Metadata:');
  console.log(JSON.stringify(fetchedMetadata, null, 2));
  console.log(`Time:    ${fetchTime.toFixed(2)}ms`);
  console.log('');

  // Verify
  console.log('-'.repeat(60));
  console.log('Verification:');

  const checks = [
    { field: 'title', expected: testMetadata.title, actual: fetchedMetadata.title },
    { field: 'description', expected: testMetadata.description, actual: fetchedMetadata.description },
    { field: 'options', expected: JSON.stringify(testMetadata.options), actual: JSON.stringify(fetchedMetadata.options) },
    { field: 'dao_pda', expected: testMetadata.dao_pda, actual: fetchedMetadata.dao_pda },
    { field: 'created_at', expected: 'present', actual: fetchedMetadata.created_at ? 'present' : 'missing' },
  ];

  let allPassed = true;
  for (const check of checks) {
    const passed = check.expected === check.actual;
    const status = passed ? 'PASS' : 'FAIL';
    console.log(`  ${status}: ${check.field}`);
    if (!passed) {
      console.log(`         Expected: ${check.expected}`);
      console.log(`         Actual:   ${check.actual}`);
      allPassed = false;
    }
  }

  console.log('');
  console.log('='.repeat(60));
  console.log('Summary:');
  console.log(`  Upload time:  ${uploadTime.toFixed(2)}ms`);
  console.log(`  Fetch time:   ${fetchTime.toFixed(2)}ms`);
  console.log(`  Total time:   ${(uploadTime + fetchTime).toFixed(2)}ms`);
  console.log(`  Result:       ${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
  console.log('='.repeat(60));

  process.exit(allPassed ? 0 : 1);
}

main();
