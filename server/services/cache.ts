import memoizee from 'memoizee';
import { storage } from '../storage';

/**
 * Cache Service
 * 
 * Provides in-memory caching for frequently accessed data to reduce database load.
 * Uses memoizee for automatic cache expiration and size limits.
 */

// Cache user contractor relationship (permissions) for 5 minutes
// This is frequently accessed on every authenticated request
export const getUserContractorCached = memoizee(
  async (userId: string, contractorId: string) => {
    return storage.getUserContractor(userId, contractorId);
  },
  {
    promise: true,
    maxAge: 5 * 60 * 1000, // 5 minutes
    max: 1000, // Max 1000 entries
    preFetch: true, // Refresh before expiry
    normalizer: (args) => `${args[0]}-${args[1]}`, // Create unique cache key
  }
);

// Cache user's contractors list for 5 minutes
export const getUserContractorsCached = memoizee(
  async (userId: string) => {
    return storage.getUserContractors(userId);
  },
  {
    promise: true,
    maxAge: 5 * 60 * 1000, // 5 minutes
    max: 500,
    preFetch: true,
  }
);

// Cache contractor settings for 10 minutes (changes infrequently)
export const getContractorCached = memoizee(
  async (contractorId: string) => {
    return storage.getContractor(contractorId);
  },
  {
    promise: true,
    maxAge: 10 * 60 * 1000, // 10 minutes
    max: 500,
    preFetch: true,
  }
);

// Cache terminology settings for 15 minutes (changes very infrequently)
export const getTerminologySettingsCached = memoizee(
  async (contractorId: string) => {
    return storage.getTerminologySettings(contractorId);
  },
  {
    promise: true,
    maxAge: 15 * 60 * 1000, // 15 minutes
    max: 500,
    preFetch: true,
  }
);

// Cache business targets for 10 minutes
export const getBusinessTargetsCached = memoizee(
  async (contractorId: string) => {
    return storage.getBusinessTargets(contractorId);
  },
  {
    promise: true,
    maxAge: 10 * 60 * 1000, // 10 minutes
    max: 500,
    preFetch: true,
  }
);

// Cache user details for 3 minutes
export const getUserCached = memoizee(
  async (userId: string) => {
    return storage.getUser(userId);
  },
  {
    promise: true,
    maxAge: 3 * 60 * 1000, // 3 minutes
    max: 1000,
    preFetch: true,
  }
);

/**
 * Cache invalidation helpers
 * Call these when data changes to ensure cache consistency
 */
export const cacheInvalidation = {
  // Invalidate user contractor cache when permissions change
  invalidateUserContractor: (userId: string, contractorId: string) => {
    getUserContractorCached.delete(userId, contractorId);
    getUserContractorsCached.delete(userId);
  },

  // Invalidate all caches for a user
  invalidateUser: (userId: string) => {
    getUserCached.delete(userId);
    getUserContractorsCached.delete(userId);
  },

  // Invalidate contractor settings cache
  invalidateContractor: (contractorId: string) => {
    getContractorCached.delete(contractorId);
    getTerminologySettingsCached.delete(contractorId);
    getBusinessTargetsCached.delete(contractorId);
  },

  // Invalidate terminology settings cache specifically
  invalidateTerminologySettings: (contractorId: string) => {
    getTerminologySettingsCached.delete(contractorId);
  },

  // Clear all caches
  clearAll: () => {
    getUserContractorCached.clear();
    getUserContractorsCached.clear();
    getContractorCached.clear();
    getTerminologySettingsCached.clear();
    getBusinessTargetsCached.clear();
    getUserCached.clear();
  },
};

// Export cache statistics for monitoring
export const getCacheStats = () => {
  return {
    userContractors: {
      size: getUserContractorCached.length,
      maxAge: '5 minutes',
    },
    contractors: {
      size: getContractorCached.length,
      maxAge: '10 minutes',
    },
    terminology: {
      size: getTerminologySettingsCached.length,
      maxAge: '15 minutes',
    },
    users: {
      size: getUserCached.length,
      maxAge: '3 minutes',
    },
  };
};
