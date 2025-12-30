/*
 * Test script for withdrawal_percentage feature
 * Run with: pnpm tsx ui/scripts/test-withdrawal-percentage.ts
 */

import { Pool } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

import {
  getWithdrawalPercentage,
  updateWithdrawalPercentage,
  getAllDaos,
} from '../lib/db/daos';

async function testWithdrawalPercentage() {
  const pool = new Pool({ connectionString: process.env.DB_URL });

  try {
    // 1. Get all DAOs and check they have withdrawal_percentage
    console.log('=== Test 1: Check existing DAOs have withdrawal_percentage ===');
    const daos = await getAllDaos(pool);
    console.log(`Found ${daos.length} DAOs`);

    for (const dao of daos.slice(0, 3)) {
      console.log(`  DAO: ${dao.dao_name}, withdrawal_percentage: ${dao.withdrawal_percentage}`);
    }

    if (daos.length === 0) {
      console.log('No DAOs found - skipping update test');
      console.log('\n=== Tests completed (no DAOs to test) ===');
      return;
    }

    // 2. Test getWithdrawalPercentage function
    console.log('\n=== Test 2: getWithdrawalPercentage function ===');
    const testDao = daos[0];
    const currentPct = await getWithdrawalPercentage(pool, testDao.id!);
    console.log(`DAO "${testDao.dao_name}" current withdrawal_percentage: ${currentPct}`);

    // 3. Test updateWithdrawalPercentage function
    console.log('\n=== Test 3: updateWithdrawalPercentage function ===');
    const newPct = currentPct === 12 ? 25 : 12; // Toggle between 12 and 25
    console.log(`Updating to ${newPct}%...`);
    await updateWithdrawalPercentage(pool, testDao.id!, newPct);

    // 4. Verify the update
    const updatedPct = await getWithdrawalPercentage(pool, testDao.id!);
    console.log(`After update: ${updatedPct}%`);

    if (updatedPct === newPct) {
      console.log('✓ Update successful!');
    } else {
      console.log('✗ Update failed - value mismatch');
      process.exit(1);
    }

    // 5. Restore original value
    console.log(`\nRestoring original value (${currentPct}%)...`);
    await updateWithdrawalPercentage(pool, testDao.id!, currentPct);
    const restoredPct = await getWithdrawalPercentage(pool, testDao.id!);
    console.log(`Restored: ${restoredPct}%`);

    // 6. Test validation (should throw for invalid values)
    console.log('\n=== Test 4: Validation (should reject invalid values) ===');

    let rejectedBelowMin = false;
    try {
      await updateWithdrawalPercentage(pool, testDao.id!, 4);
      console.log('✗ Should have rejected 4% (below minimum of 5%)');
    } catch (e) {
      console.log('✓ Correctly rejected 4% (below minimum of 5%)');
      rejectedBelowMin = true;
    }

    let rejected51 = false;
    try {
      await updateWithdrawalPercentage(pool, testDao.id!, 51);
      console.log('✗ Should have rejected 51%');
    } catch (e) {
      console.log('✓ Correctly rejected 51%');
      rejected51 = true;
    }

    if (rejectedBelowMin && rejected51) {
      console.log('\n=== All tests passed! ===');
    } else {
      console.log('\n=== Some validation tests failed ===');
      process.exit(1);
    }

  } catch (error) {
    console.error('Test error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testWithdrawalPercentage();
