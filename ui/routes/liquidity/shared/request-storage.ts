/*
 * Z Combinator - Solana Token Launchpad
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import * as crypto from 'crypto';

/**
 * Base interface for all request data types
 */
export interface BaseRequestData {
  timestamp: number;
  poolAddress: string;
  adminWallet?: string;
}

/**
 * Generic request storage with automatic TTL-based cleanup
 */
export class RequestStorage<T extends BaseRequestData> {
  private requests = new Map<string, T>();
  private cleanupInterval: NodeJS.Timeout | null = null;
  private readonly ttlMs: number;
  private readonly cleanupIntervalMs: number;

  /**
   * Create a new request storage
   * @param ttlMs - Time-to-live for requests in milliseconds (default: 15 minutes)
   * @param cleanupIntervalMs - How often to run cleanup (default: 5 minutes)
   */
  constructor(ttlMs: number = 15 * 60 * 1000, cleanupIntervalMs: number = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.startCleanup();
  }

  /**
   * Generate a unique request ID
   */
  generateRequestId(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Store a request with auto-generated timestamp
   */
  set(requestId: string, data: Omit<T, 'timestamp'> & { timestamp?: number }): void {
    this.requests.set(requestId, {
      ...data,
      timestamp: data.timestamp ?? Date.now(),
    } as T);
  }

  /**
   * Retrieve a request by ID
   */
  get(requestId: string): T | undefined {
    return this.requests.get(requestId);
  }

  /**
   * Delete a request by ID
   */
  delete(requestId: string): boolean {
    return this.requests.delete(requestId);
  }

  /**
   * Check if a request exists
   */
  has(requestId: string): boolean {
    return this.requests.has(requestId);
  }

  /**
   * Check if a request has expired
   * @param requestId - The request ID to check
   * @param customTtlMs - Optional custom TTL (useful for shorter expiry like 10 min for confirms)
   */
  isExpired(requestId: string, customTtlMs?: number): boolean {
    const data = this.requests.get(requestId);
    if (!data) return true;
    const ttl = customTtlMs ?? this.ttlMs;
    return Date.now() - data.timestamp > ttl;
  }

  /**
   * Get the number of stored requests
   */
  get size(): number {
    return this.requests.size;
  }

  /**
   * Start the automatic cleanup interval
   */
  private startCleanup(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [requestId, data] of this.requests.entries()) {
        if (now - data.timestamp > this.ttlMs) {
          this.requests.delete(requestId);
        }
      }
    }, this.cleanupIntervalMs);

    // Don't prevent Node.js from exiting
    this.cleanupInterval.unref();
  }

  /**
   * Stop the automatic cleanup interval
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all stored requests
   */
  clear(): void {
    this.requests.clear();
  }
}

/**
 * Request expiry constants
 */
export const REQUEST_EXPIRY = {
  BUILD: 15 * 60 * 1000,    // 15 minutes for build requests
  CONFIRM: 10 * 60 * 1000,  // 10 minutes for confirm operations
} as const;
