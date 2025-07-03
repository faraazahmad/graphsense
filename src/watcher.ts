import { watch, FSWatcher } from "node:fs";
import { resolve, extname } from "node:path";
import { existsSync } from "node:fs";
import { parseFile } from "./index";
import { db, setupDB } from "./db";

interface WatcherOptions {
  watchPath: string;
  extensions?: string[];
  ignorePatterns?: RegExp[];
  debounceMs?: number;
}

interface WatcherState {
  watcher: FSWatcher | null;
  debounceTimers: Map<string, NodeJS.Timeout>;
  options: Required<WatcherOptions>;
}

// Helper functions
const createDefaultOptions = (
  options: WatcherOptions,
): Required<WatcherOptions> => ({
  watchPath: resolve(options.watchPath),
  extensions: options.extensions || [".js", ".ts", ".json"],
  ignorePatterns: options.ignorePatterns || [
    /node_modules/,
    /\.git/,
    /build/,
    /dist/,
  ],
  debounceMs: options.debounceMs || 1000,
});

const shouldIgnoreFile = (
  filePath: string,
  options: Required<WatcherOptions>,
): boolean => {
  const ext = extname(filePath);

  // Check if file extension is in the allowed list
  if (!options.extensions.includes(ext)) {
    return true;
  }

  // Check if file matches any ignore patterns
  return options.ignorePatterns.some((pattern) => pattern.test(filePath));
};

const processFileChange = async (
  filePath: string,
  options: Required<WatcherOptions>,
): Promise<void> => {
  const absolutePath = resolve(filePath);

  if (shouldIgnoreFile(absolutePath, options)) {
    return;
  }

  try {
    console.log(`Parsing changed file: ${absolutePath}`);
    await parseFile(absolutePath);
    console.log(`Successfully processed: ${absolutePath}`);
  } catch (error) {
    console.error(`Error processing file change for ${absolutePath}:`, error);
  }
};

const handleFileChange =
  (state: WatcherState) =>
  (eventType: string, filename: string | null): void => {
    if (!filename) return;

    const filePath = resolve(state.options.watchPath, filename);

    // Skip if file doesn't exist (might be deleted)
    if (!existsSync(filePath)) {
      return;
    }

    // Debounce file changes to avoid multiple rapid calls
    const existingTimer = state.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      processFileChange(filePath, state.options);
      state.debounceTimers.delete(filePath);
    }, state.options.debounceMs);

    state.debounceTimers.set(filePath, timer);
  };

const startWatcher = (options: WatcherOptions): WatcherState => {
  const watcherOptions = createDefaultOptions(options);

  if (!existsSync(watcherOptions.watchPath)) {
    throw new Error(`Watch path does not exist: ${watcherOptions.watchPath}`);
  }

  const state: WatcherState = {
    watcher: null,
    debounceTimers: new Map(),
    options: watcherOptions,
  };

  console.log(`Starting file watcher on: ${watcherOptions.watchPath}`);
  console.log(`Watching extensions: ${watcherOptions.extensions.join(", ")}`);
  console.log(
    `Ignoring patterns: ${watcherOptions.ignorePatterns.map((p) => p.source).join(", ")}`,
  );

  try {
    // Watch the directory recursively
    const watcher = watch(
      watcherOptions.watchPath,
      { recursive: true },
      handleFileChange(state),
    );

    state.watcher = watcher;

    watcher.on("error", (error) => {
      console.error("File watcher error:", error);
    });

    console.log("File watcher started successfully");
    return state;
  } catch (error) {
    console.error("Failed to start file watcher:", error);
    throw error;
  }
};

const stopWatcher = (state: WatcherState): void => {
  console.log("Stopping file watcher...");

  // Clear all debounce timers
  state.debounceTimers.forEach((timer) => clearTimeout(timer));
  state.debounceTimers.clear();

  // Close the watcher
  if (state.watcher) {
    state.watcher.close();
    state.watcher = null;
  }

  console.log("File watcher stopped");
};

const createShutdownHandler = (state: WatcherState) => (): void => {
  console.log("\nReceived shutdown signal...");
  stopWatcher(state);
  process.exit(0);
};

// Main function to run the watcher
const main = async (): Promise<void> => {
  await setupDB();
  const watchPath = process.argv[2];

  if (!watchPath) {
    console.error("Usage: node watcher.js <path-to-watch>");
    process.exit(1);
  }

  const watcherState = startWatcher({
    watchPath,
    extensions: [".js", ".ts", ".json"],
    ignorePatterns: [
      /node_modules/,
      /\.git/,
      /build/,
      /dist/,
      /logs/,
      /\.log$/,
      /\.tmp$/,
      /\.temp$/,
    ],
    debounceMs: 1000,
  });

  // Handle graceful shutdown
  const shutdown = createShutdownHandler(watcherState);
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  try {
    console.log("File watcher is running. Press Ctrl+C to stop.");

    // Keep the process alive
    process.stdin.resume();
  } catch (error) {
    console.error("Failed to start file watcher:", error);
    process.exit(1);
  }
};

// Run main function if this file is executed directly
if (require.main === module) {
  main().catch((error) => {
    console.error("Unhandled error:", error);
    process.exit(1);
  });
}
