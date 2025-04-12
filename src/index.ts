import { createSourceFile, forEachChild, ImportDeclaration, isNamedImports, NamedImports, Node, ScriptTarget, SyntaxKind } from 'typescript';
import { resolve, dirname } from 'node:path';
import { globSync, readFileSync } from 'node:fs';
import { debug } from 'node:console';
import { executeQuery } from './db';

interface ImportData {
    clause: string
    source: string
}

function parseFile(path: string, results: ImportData[]): ImportData[] {
    const content = readFileSync(path, 'utf-8');
    const sourceFile = createSourceFile(
        path,
        content,
        ScriptTarget.ES2020,
        true
    );

    forEachChild(sourceFile, (child) => {
        const result = traverse(path, child);
        results = [...results, ...result];
    })

    return results;
}

// let results: any[] = [];
function traverse(filePath: string, node: Node): ImportData[] {
    if (node.getChildCount() === 0) { return []; }

    let result: ImportData[] = [];
    if (node.kind === SyntaxKind.ImportDeclaration) {
        const importDeclaration = node as ImportDeclaration;
        const importData = {
            clause: "",
            source: "",
        } as ImportData;

        forEachChild(node, (child) => {
            if (child.kind === SyntaxKind.StringLiteral) {
                let path;
                const text = child.getText();
                if (text.includes('./')) {
                    // console.log(text)
                    let rawPath = `${dirname(filePath)}/${text.slice(1, text.length - 1)}`;
                    if (rawPath.includes('./') && !(rawPath.endsWith('.js') || rawPath.endsWith('.json'))) { rawPath += '.js'; }
                    path = resolve(rawPath);
                    // console.log(path)
                } else {
                    path = text.slice(1, text.length - 1);
                }

                importData.source = path;
            }
        });

        if (importDeclaration.importClause?.namedBindings) {
            const namedBindings = importDeclaration.importClause.namedBindings;

            // Check if named bindings are NamedImports
            if (namedBindings.kind === SyntaxKind.NamedImports) {
                const namedImports = namedBindings as NamedImports;

                // Access each element in NamedImports
                namedImports.elements.forEach(element => {
                    result.push({ clause: element.name.text, source: importData.source });
                });
            }
        } else if (importDeclaration.importClause?.name) {
            importData.clause = importDeclaration.importClause.name.getText();
            result.push(importData);
        }
    }
    return result;
}

// print();
// executeQuery(`
//     CREATE CONSTRAINT unique_file_path
//     FOR (file:File)
//     REQUIRE file.path IS UNIQUE
// `, {})
//     .then(result => console.log(result.records))
//     .catch(err => console.error(err));

function registerFile(path: string) {
    let results: ImportData[] = [];
    if (!(path[0] === '/')) { return results; }

    results = parseFile(path, []);

    executeQuery(`
      MERGE (file:File {path: $path})
      `,
        { path: path })
        // .then(result => console.log(result.records))
        .catch(err => console.error(err));

    for (const result of results) {
        executeQuery(`
          MERGE (file: File {path: $path})
      `,
            { path: result.source })
            // .then(result => console.log(result.records))
            .catch(err => console.error(err));

        executeQuery(`
         match (file1:File { path: $source }), (file2:File { path: $path })
         merge (file1)-[:IMPORTS_FROM]->(file2)
      `,
            { source: path, path: result.source })
            // .then(result => console.log(result.records))
            .catch(err => console.error(err));

        // registerFile(result.source);
    }

    console.log(`Completed parsing file: ${path}`)
    return results;
}
// executeQuery(`
//   CREATE (a:Person {name: $name})
//   CREATE (b:Person {friend: $name})
//   CREATE (a)-[:KNOWS]->(b)
//   `,
//   {});
//
const REPO_PATH = `${resolve('.')}/rs-admin-api`;
const FACILITY_CONTROLLER = `${resolve('.')}/rs-admin-api/src/controllers/facilityAccount.controller.js`;
const fileList = globSync(`${REPO_PATH}/**/**/*.js`)

for (const file of fileList) {
    const results = registerFile(file);
    for (const result of results) {
        try {
            registerFile(result.source);
        } catch (err) {
            console.error(err);
            break;
        }
    }
}
