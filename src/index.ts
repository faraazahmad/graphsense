import {
  ImportDeclaration,
  NamedImports,
  createSourceFile,
  forEachChild,
  FunctionDeclaration,
  Node,
  ScriptTarget,
  SyntaxKind,
  isStringLiteral,
} from "typescript";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { globSync } from "glob";
import { executeQuery, setupDB } from "./db";
import { parseFunctionDeclaration } from "./parse";
import { parseGitignore } from "./gitignoreUtils";

interface FunctionParseDTO {
  node: FunctionDeclaration;
  functionNodeId: string;
  reParse: boolean;
}
export const functionParseQueue: Array<FunctionParseDTO> = [];

// Configurable delay for API rate limiting (in milliseconds)
const API_RATE_LIMIT_DELAY = 1000; // 1 second delay between function parsing calls

interface ImportData {
  clause: string;
  source: string;
}

function traverseNodes(filePath: string, node: Node): void | ImportData[] {
  if (node.getChildCount() === 0) {
    return [];
  }

  let result: ImportData[] = [];
  if (node.kind === SyntaxKind.ImportDeclaration) {
    const importDeclaration = node as ImportDeclaration;
    const importData = {
      clause: "",
      source: "",
    } as ImportData;

    forEachChild(node, (child) => {
      if (!isStringLiteral(child)) {
        return;
      }

      let path;
      const text = child.getText();
      if (text.includes("./")) {
        let rawPath = `${dirname(filePath)}/${text.slice(1, text.length - 1)}`;
        if (
          rawPath.includes("./") &&
          !(rawPath.endsWith(".js") || rawPath.endsWith(".json"))
        ) {
          rawPath += ".js";
        }
        path = resolve(rawPath);
      } else {
        path = text.slice(1, text.length - 1);
      }

      importData.source = path;
    });

    if (importDeclaration.importClause?.namedBindings) {
      const namedBindings = importDeclaration.importClause.namedBindings;

      // Check if named bindings are NamedImports
      if (namedBindings.kind === SyntaxKind.NamedImports) {
        const namedImports = namedBindings as NamedImports;

        // Access each element in NamedImports
        namedImports.elements.forEach((element) => {
          result.push({
            clause: element.name.text,
            source: cleanPath(importData.source),
          });
        });
      }
    } else if (importDeclaration.importClause?.name) {
      importData.clause = importDeclaration.importClause.name.getText();
      result.push(importData);
    }
  } else if (node.kind === SyntaxKind.FunctionDeclaration) {
    const functionNode = node as FunctionDeclaration;

    // TODO: better handle anonymous functions
    if (!functionNode.name?.escapedText) {
      return;
    }

    // Add function to parse queue instead of parsing immediately
    const functionNodeId = `${cleanPath(filePath)}:${functionNode.name.escapedText.toString()}`;
    functionParseQueue.push({
      node: functionNode,
      functionNodeId,
      reParse: false,
    });
  }
  return result;
}

export async function parseFile(path: string) {
  let results: ImportData[] = [];
  if (!(path[0] === "/")) {
    return results;
  }

  let content;
  try {
    content = readFileSync(path, "utf-8");
  } catch (error: any) {
    console.error(`${error.message} in ${path}`);
  }
  const sourceFile = createSourceFile(
    path,
    content!,
    ScriptTarget.ES2020,
    true,
  );

  // Ensure the current file has a node in the graph
  const normalizedPath = cleanPath(path);
  await executeQuery(`MERGE (f:File {path: $path})`, {
    path: normalizedPath,
  }).catch((err) => console.error(err));

  forEachChild(sourceFile, (child) => {
    const nodeResults = traverseNodes(path, child);
    if (nodeResults) {
      for (const result of nodeResults) {
        results.push(result);
      }
    }
  });

  for (const result of results) {
    await executeQuery(
      `
        MERGE (file: File {path: $path})
      `,
      { path: cleanPath(result.source) },
    ).catch((err) => console.error(err));

    await executeQuery(
      `
        MERGE (file1:File { path: $source })
        MERGE (file2:File { path: $path })
        MERGE (file1)-[:IMPORTS_FROM { clause: $clause }]->(file2)
      `,
      {
        source: cleanPath(path),
        path: cleanPath(result.source),
        clause: result.clause,
      },
    ).catch((err) => console.error(err));
  }

  return results;
}

export function getRepoPath(): string {
  if (process.argv[2]) {
    const cmdArgPath = process.argv[2];
    if (!existsSync(cmdArgPath)) {
      console.error(`Command line argument path does not exist: ${cmdArgPath}`);
      process.exit(1);
    }
    return cmdArgPath;
  }

  return "";
}

export function cleanPath(path: string) {
  const repoPath = getRepoPath();
  return path.replace(repoPath, "");
}

// Event loop to process function parse queue with rate limiting
export async function processFunctionParseQueue() {
  console.log(
    `Starting function parse queue processing with ${functionParseQueue.length} items`,
  );

  while (functionParseQueue.length > 0) {
    const item = functionParseQueue[0]; // Peek at first item without removing
    if (!item) break;

    try {
      console.log(
        `Processing function ${item.functionNodeId} (${functionParseQueue.length} remaining)`,
      );
      await parseFunctionDeclaration(item.node);

      // Only remove from queue if parsing was successful
      functionParseQueue.shift();

      // Apply delay for API rate limiting
      if (functionParseQueue.length > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, API_RATE_LIMIT_DELAY),
        );
      }
    } catch (error) {
      console.error(`Error processing function ${item.functionNodeId}:`, error);
      // Item remains in queue for potential retry
    }
  }

  console.log("Completed processing function parse queue");
}

async function main() {
  try {
    await setupDB();
    console.log("Starting code analysis...");

    const repoPath = getRepoPath();

    // Parse gitignore patterns
    const gitignorePatterns = parseGitignore(repoPath);

    const fileList = globSync(`${repoPath}/**/*.{js,ts,json}`, {
      absolute: true,
      ignore:
        gitignorePatterns.globPatterns.length > 0
          ? gitignorePatterns.globPatterns
          : undefined,
    });

    console.log(`Found ${fileList.length} files to analyze`);

    console.log("Starting file parsing...");
    let processedFiles = 0;
    for (const file of fileList) {
      try {
        await parseFile(file);
        processedFiles++;
      } catch (error) {
        console.error(`Error parsing file ${file}:`, error);
      }
    }
    console.log(`Completed parsing ${processedFiles} files`);

    // Process function parse queue with rate limiting
    if (functionParseQueue.length > 0) {
      console.log(
        `Starting function analysis for ${functionParseQueue.length} functions...`,
      );
      await processFunctionParseQueue();
    }

    process.exit(0);
  } catch (error) {
    console.error("Fatal error in main function:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
