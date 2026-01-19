/*
 * Combinator - Futarchy infrastructure for your project.
 * Copyright (C) 2026 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 * Questions or feature requests? Reach out:
 * - Telegram Group: https://t.me/+Ao05jBnpEE0yZGVh
 * - Direct: https://t.me/handsdiff
 */

// In-memory proposal count cache
// Caches proposal counts per DAO to avoid expensive on-chain fetches on the
// projects page. Populated lazily when proposals are fetched, updated on
// proposal creation. No TTL needed since we control proposal creation.
const proposalCountCache = new Map<string, number>();

/**
 * Get cached proposal count for a DAO.
 * Returns undefined if not cached (needs to be fetched).
 */
export function getCachedProposalCount(daoPda: string): number | undefined {
  return proposalCountCache.get(daoPda);
}

/**
 * Set the proposal count cache for a DAO.
 * Called after fetching proposals from chain.
 */
export function setCachedProposalCount(daoPda: string, count: number): void {
  proposalCountCache.set(daoPda, count);
}

/**
 * Increment the proposal count cache for a DAO.
 * Called after successfully creating a proposal.
 */
export function incrementProposalCount(daoPda: string): void {
  const current = proposalCountCache.get(daoPda);
  if (current !== undefined) {
    proposalCountCache.set(daoPda, current + 1);
  }
  // If not cached, don't initialize - let it be populated on next fetch
}
