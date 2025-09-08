import * as fc from 'fast-check';
import { createRepoHash } from '../entrypoint';

describe('createRepoHash Property Tests', () => {
  it('is deterministic - same input produces same output', () =>
    fc.assert(
      fc.property(fc.string(), (path) => {
        expect(createRepoHash(path)).toBe(createRepoHash(path));
      }),
    ));

  it('produces exactly 16 lowercase hex characters', () =>
    fc.assert(
      fc.property(fc.string(), (path) => {
        const hash = createRepoHash(path);
        expect(hash).toMatch(/^[0-9a-f]{16}$/);
      }),
    ));

  it('rarely collides - different inputs produce different hashes', () =>
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string(), { minLength: 50, maxLength: 100 }),
        (paths) => {
          const hashes = paths.map(createRepoHash);
          // Set size should equal array length (no collisions)
          expect(new Set(hashes).size).toBe(hashes.length);
        }),
      { numRuns: 50 }, // Tests thousands of combinations
    ));

  it('handles edge case inputs correctly', () =>
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(''), // empty string
          fc.string({ minLength: 1000, maxLength: 2000 }), // very long
          fc.fullUnicodeString(), // unicode characters
          fc.string().map(s => s.replace(/\//g, '\\')), // Windows paths
        ),
        (path) => {
          const hash = createRepoHash(path);
          expect(hash).toMatch(/^[0-9a-f]{16}$/);
          expect(hash.length).toBe(16);
        }),
    ));
});
