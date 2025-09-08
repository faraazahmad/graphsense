// Global test setup
// Increase timeout for property tests
jest.setTimeout(30000);

// Mock environment variables commonly used in tests
process.env.NODE_ENV = 'test';
process.env.HOME = '/tmp/test-home';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.PINECONE_API_KEY = 'test-pinecone-key';

// Global test utilities for property testing
global.testUtils = {
  // Helper to run property tests with custom configuration
  runPropertyTest: (property, options = {}) => {
    const defaultOptions = {
      numRuns: 100,
      seed: 42, // For reproducible tests
      ...options,
    };
    return require('fast-check').assert(property, defaultOptions);
  },
};
