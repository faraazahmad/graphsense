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
import { GITHUB_PAT, HOME_PATH, REPO_PATH, REPO_URI, NODE_ENV } from "./env";

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
    executeQuery(
      `MATCH (function:Function {name: $name, path: $path}) return elementId(function) as id`,
      {
        path: cleanPath(node.getSourceFile().fileName),
        name: functionNode.name?.escapedText,
      },
    )
      .then(async (result) => {
        const fileId = result.records.map((rec) => rec.get("id"));
        const fxn = await db.relational.client!.query(
          `select id from functions where id = $1 limit 1`,
          [fileId[0]],
        );
        if (fxn.rows.length) {
          return;
        }

        parseFunctionDeclaration(functionNode, false);
      })
      .catch((err) => {
        console.log(functionNode.name?.escapedText);
        console.log(functionNode.getSourceFile().fileName);
        console.error(err);
        process.exit(-1);
      });
  }
  return result;
}

async function parseFile(path: string) {
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
  if (NODE_ENV === "development") {
    if (process.argv[2]) {
      const cmdArgPath = process.argv[2];
      if (!existsSync(cmdArgPath)) {
        console.error(
          `Command line argument path does not exist: ${cmdArgPath}`,
        );
        process.exit(1);
      }
      return cmdArgPath;
    } else {
      console.log(
        `Development mode: No command line argument provided. Usage: npm start <path-to-repo>`,
      );
      console.log(`Falling back to default repository path: ${REPO_PATH}`);
    }
  } else {
    console.log(`Using default repository path: ${REPO_PATH}`);
  }
  return REPO_PATH;
}

export function cleanPath(path: string) {
  const repoPath = getRepoPath();
  return path.replace(repoPath, "");
}

async function useRepo(): Promise<PrePassResultDTO> {
  // Cloning logic commented out - using LOCAL_REPO_PATH environment variable instead
  /*
  const isHttpUrl =
    REPO_URI.startsWith("http://") || REPO_URI.startsWith("https://");
  const isSshUrl = REPO_URI.startsWith("git@");
  const isLocalPath = !isHttpUrl && !isSshUrl && existsSync(REPO_URI);

  if (isHttpUrl || isSshUrl) {
    let org: string, repoName: string, cloneUrl: string;

    if (isHttpUrl) {
      cloneUrl = REPO_URI.replace("github", `faraazahmad:${GITHUB_PAT}@github`);
      const url = new URL(cloneUrl);
      const pathParts = url.pathname
        .split("/")
        .filter((part) => part.length > 0);
      org = pathParts[0];
      repoName = pathParts[1].replace(/^rs-/, "").replace(/\.git$/, "");
    } else {
      // SSH URL format: git@github.com:org/repo.git
      cloneUrl = REPO_URI;
      const colonIndex = REPO_URI.indexOf(":");
      const pathAfterColon = REPO_URI.substring(colonIndex + 1);
      const pathParts = pathAfterColon.split("/");
      org = pathParts[0];
      repoName = pathParts[1].replace(/^rs-/, "").replace(/\.git$/, "");
    }

    const orgPath = `${HOME_PATH}/.graphsense/${org}`;
    if (!existsSync(orgPath)) {
      console.log("doesnt exist");
      mkdirSync(orgPath, {
        recursive: true,
      });
    }
    const targetPath = `${HOME_PATH}/.graphsense/${org}/${repoName}`;

    if (!existsSync(targetPath)) {
      console.log(`Cloning ${cloneUrl} to ${targetPath}`);
      execSync(`git clone --depth 1 ${cloneUrl} ${targetPath}`, {
        stdio: "inherit",
      });
    }
  } else if (isLocalPath) {
    console.log(`Using local repository at ${REPO_URI}`);
  }
  */

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

// export async function prePass(): Promise<string> {
//   console.log("Starting prepass");
//   const { branch, path } = await useRepo();
//   await setupDB(branch);

//   return Promise.resolve(path);
// }

// async function passOne() {
//   console.log("Starting pass one");
//   const repoPath = getRepoPath();
//   const fileList = globSync(`${repoPath}/**/**/*.js`, {
//     absolute: true,
//     ignore: ["**/node_modules/**"],
//   });

//   fileList.forEach(parseFile);

//   return Promise.resolve();
// }

// async function passTwo() {
//   console.log("Starting pass two");
//   setInterval(() => {
//     parseTopFunctionNode();
//   }, 5 * 1000);

//   return Promise.resolve();
// }

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

    // First pass: parse files and extract functions
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

    // Second pass: get all functions from database and process with AI
    console.log("Starting AI processing of functions...");
    try {
      const result = await db.relational.client!.query(
        `SELECT id, name, path, start_line, end_line FROM functions`,
      );

      console.log(`Found ${result.rows.length} functions to process with AI`);

      if (result.rows.length === 0) {
        console.log("No functions need AI processing");
        return;
      }

      await Promise.all(result.rows.map(processFunctionWithAI));

      console.log(`Completed AI processing of ${result.rowCount} functions`);
    } catch (error) {
      console.error("Error querying functions from database:", error);
    }

    console.log("Code analysis completed successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Fatal error in main function:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
