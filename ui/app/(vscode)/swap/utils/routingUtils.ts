import { Token, SwapRoute } from '../types';
import { POOLS, getPoolForPair } from '../constants';

/**
 * Determine the optimal swap route for a token pair
 * Returns 'direct-cp', 'direct-dbc', 'double', 'triple', or 'invalid'
 */
export function getSwapRoute(from: Token, to: Token): SwapRoute {
  if (from === to) return 'invalid';

  // Check for direct pool
  const directPool = getPoolForPair(from, to);
  if (directPool) {
    return directPool.type === 'cp-amm' ? 'direct-cp' : 'direct-dbc';
  }

  // Check for 2-hop routes
  const twoHopRoute = findMultiHopRoute(from, to, 2);
  if (twoHopRoute) return 'double';

  // Check for 3-hop routes
  const threeHopRoute = findMultiHopRoute(from, to, 3);
  if (threeHopRoute) return 'triple';

  return 'invalid';
}

/**
 * Find a multi-hop route between two tokens
 * Returns the intermediate tokens if a route exists, or null if not
 */
export function findMultiHopRoute(
  from: Token,
  to: Token,
  maxHops: number
): Token[] | null {
  // BFS to find shortest path
  const queue: { token: Token; path: Token[] }[] = [{ token: from, path: [from] }];
  const visited = new Set<Token>([from]);

  while (queue.length > 0) {
    const { token, path } = queue.shift()!;

    if (path.length > maxHops) continue;

    // Get all tokens connected to current token
    const connectedTokens = getConnectedTokens(token);

    for (const nextToken of connectedTokens) {
      if (nextToken === to) {
        // Found the destination
        return [...path, to];
      }

      if (!visited.has(nextToken) && path.length < maxHops) {
        visited.add(nextToken);
        queue.push({ token: nextToken, path: [...path, nextToken] });
      }
    }
  }

  return null;
}

/**
 * Get all tokens directly connected to a given token via pools
 */
function getConnectedTokens(token: Token): Token[] {
  const connected: Token[] = [];

  for (const pool of POOLS) {
    if (pool.tokenA === token) {
      connected.push(pool.tokenB);
    } else if (pool.tokenB === token) {
      connected.push(pool.tokenA);
    }
  }

  return connected;
}

/**
 * Get the intermediate tokens for a multi-hop route
 * @example getIntermediateTokens('SOL', 'TEST') // returns ['ZC']
 */
export function getIntermediateTokens(from: Token, to: Token): Token[] {
  const route = getSwapRoute(from, to);

  if (route === 'direct-cp' || route === 'direct-dbc' || route === 'invalid') {
    return [];
  }

  const maxHops = route === 'double' ? 2 : 3;
  const path = findMultiHopRoute(from, to, maxHops);

  if (!path) return [];

  // Return all tokens except first and last
  return path.slice(1, -1);
}
