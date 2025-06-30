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
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { globSync } from "glob";
import { execSync } from "node:child_process";
import { db, executeQuery, setupDB } from "./db";
import { parseFunctionDeclaration, processFunctionWithAI } from "./parse";
import { HOME_PATH, REPO_PATH, NODE_ENV } from "./env";
import { hash } from "node:crypto";

interface FunctionParseDTO {
  node: FunctionDeclaration;
  functionNodeId: string;
  reParse: boolean;
}

interface PrePassResultDTO {
  branch: string;
  path: string;
}

let parseIndex = 0;
export const functionParseQueue: Array<FunctionParseDTO> = [];

interface ImportData {
  clause: string;
  source: string;
}

interface PrePassResultDTO {
  branch: string;
  path: string;
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

    parseFunctionDeclaration(functionNode);
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
        match (file1:File { path: $source }), (file2:File { path: $path })
        merge (file1)-[:IMPORTS_FROM { clause: $clause }]->(file2)
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

  return REPO_PATH;
}

export function cleanPath(path: string) {
  const repoPath = getRepoPath();
  return path.replace(repoPath, "");
}

export async function useRepo(): Promise<PrePassResultDTO> {
  // Use the repository path from environment variable or command line arg
  const repoPath = getRepoPath();
  console.log(`Using repository at ${repoPath}`);

  // const defaultBranch = execSync(
  //   `git -C ${repoPath} rev-parse --abbrev-ref HEAD`,
  //   {
  //     encoding: "utf8",
  //   },
  // ).trim();

  return Promise.resolve({
    branch: "main",
    path: repoPath,
  });
}

async function main() {
  try {
    console.log("Starting code analysis...");

    const { branch, path } = await useRepo();
    console.log(`Setting up database for branch: ${branch}`);
    await setupDB(branch);

    const repoPath = getRepoPath();
    const fileList = globSync(`${repoPath}/**/**/*.js`, {
      absolute: true,
      ignore: ["**/node_modules/**"],
    });

    console.log(`Found ${fileList.length} JavaScript files to analyze`);

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
    process.exit(0);
  } catch (error) {
    console.error("Fatal error in main function:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
