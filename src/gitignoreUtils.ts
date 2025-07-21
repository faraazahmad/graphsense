import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

interface GitignorePatterns {
  globPatterns: string[]; // For use with glob in index.ts (absolute paths)
  watcherPatterns: string[]; // For use with watcher in watcher.ts (relative patterns)
}

/**
 * Reads and parses a .gitignore file from the repository root
 * @param repoPath The root path of the repository
 * @returns An object containing glob patterns and regex patterns
 */
export function parseGitignore(repoPath: string): GitignorePatterns {
  const gitignorePath = resolve(repoPath, ".gitignore");

  if (!existsSync(gitignorePath)) {
    console.log("No .gitignore file found");
    return {
      globPatterns: [],
      watcherPatterns: [],
    };
  }

  try {
    const content = readFileSync(gitignorePath, "utf-8");
    const lines = content.split("\n");

    const globPatterns: string[] = [];
    const watcherPatterns: string[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();

      // Skip empty lines and comments
      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      // Skip negation patterns for simplicity
      if (trimmedLine.startsWith("!")) {
        continue;
      }

      // Convert gitignore pattern to glob pattern
      const globPattern = convertToGlobPattern(trimmedLine, repoPath);
      if (globPattern) {
        globPatterns.push(globPattern);
      }

      // Convert gitignore pattern to watcher pattern
      const watcherPattern = convertToWatcherPattern(trimmedLine);
      if (watcherPattern) {
        watcherPatterns.push(watcherPattern);
      }
    }

    return {
      globPatterns: globPatterns,
      watcherPatterns: watcherPatterns,
    };
  } catch (error) {
    console.error("Error reading .gitignore file:", error);
    return {
      globPatterns: [],
      watcherPatterns: [],
    };
  }
}

/**
 * Converts a gitignore pattern to a glob pattern for use with glob
 */
function convertToGlobPattern(pattern: string, repoPath: string): string {
  let globPattern = pattern;

  // Handle patterns that start with / (relative to repo root)
  if (pattern.startsWith("/")) {
    globPattern = pattern.substring(1);
  } else {
    // If pattern doesn't start with /, it can match at any level
    globPattern = `**/${pattern}`;
  }

  // Handle directory-only patterns (ending with /)
  if (pattern.endsWith("/")) {
    globPattern = `${globPattern}**`;
  } else {
    // For file patterns, ensure we match the pattern anywhere
    if (!globPattern.includes("*") && !globPattern.includes("/")) {
      globPattern = `**/${globPattern}`;
    }
  }

  return `${repoPath}/${globPattern}`;
}

/**
 * Converts a gitignore pattern to a relative glob pattern for use with the file watcher
 */
function convertToWatcherPattern(pattern: string): string {
  let watcherPattern = pattern;

  // Handle patterns that start with / (relative to repo root)
  if (pattern.startsWith("/")) {
    watcherPattern = pattern.substring(1);
  } else {
    // If pattern doesn't start with /, it can match at any level
    watcherPattern = `**/${pattern}`;
  }

  // Handle directory-only patterns (ending with /)
  if (pattern.endsWith("/")) {
    watcherPattern = `${watcherPattern}**`;
  } else {
    // For file patterns, ensure we match the pattern anywhere
    if (!watcherPattern.includes("*") && !watcherPattern.includes("/")) {
      watcherPattern = `**/${watcherPattern}`;
    }
  }

  return watcherPattern;
}
