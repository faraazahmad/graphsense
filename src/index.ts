import { createSourceFile, forEachChild, ImportDeclaration, isNamedImports, NamedImports, Node, ScriptTarget, SyntaxKind } from 'typescript';
import { resolve, dirname } from 'node:path';
import { globSync, readFileSync } from 'node:fs';
import { debug } from 'node:console';
import { executeQuery } from './db';

interface ImportData {
    clause: string
    source: string
}

const REPO_PATH = `${resolve('.')}/rs-admin-api`;
// function print(): void {
//     const fileList = globSync(`${REPO_PATH}/**/**/*.js`)
//
//     let i = 0;
//     for (const file of fileList) {
//         parseFile(file);
//         console.log("\n\n");
//         i += 1;
//         if (i == 10) { return; }
//     }
// }

const FACILITY_CONTROLLER = `${resolve('.')}/rs-admin-api/src/controllers/facilityAccount.controller.js`;

function parseFile(path: string, results: ImportData[]): ImportData[] {
    const content = readFileSync(path, 'utf-8');
    const sourceFile = createSourceFile(
        path,
        content,
        ScriptTarget.ES2020,
        true
    );

    return traverse(sourceFile, 0, results);
}

// let results: any[] = [];
function traverse(node: Node, level: number = 0, results: ImportData[]): ImportData[] {
    if (node.getChildCount() === 0) { return []; }

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
                    let rawPath = `${dirname(FACILITY_CONTROLLER)}/${text.slice(1, text.length - 1)}`;
                    if (rawPath.includes('./') && !rawPath.endsWith('.js')) { rawPath += '.js'; }
                    path = resolve(rawPath);
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
                    results.push({ clause: element.name.text, source: importData.source });
                });
            }
        } else if (importDeclaration.importClause?.name) {
            importData.clause = importDeclaration.importClause.name.getText();
            results.push(importData);
        }
        return results;
    }

    forEachChild(node, (child) => {
        results = traverse(child, level + 1, results)
        console.log(results)
        return;
        // results = [
        //     ...results,
        //     ...childResult
        // ];
    });
    return results;
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
    const results = parseFile(path, []);
    console.log(results.length);
    return;

    executeQuery(`
      MERGE (file:File {path: $path})
      `,
        { path: FACILITY_CONTROLLER })
        .then(result => console.log(result.records))
        .catch(err => console.error(err));

    for (const result of results) {
        executeQuery(`
          MERGE (file: File {path: $path})
      `,
            { path: result.source })
            .then(result => console.log(result.records))
            .catch(err => console.error(err));

        executeQuery(`
         match (file1:File { path: $source }), (file2:File { path: $path })
         merge (file1)-[:IMPORTS_FROM]->(file2)
      `,
            { source: FACILITY_CONTROLLER, path: result.source })
            .then(result => console.log(result.records))
            .catch(err => console.error(err));
    }
}
// executeQuery(`
//   CREATE (a:Person {name: $name})
//   CREATE (b:Person {friend: $name})
//   CREATE (a)-[:KNOWS]->(b)
//   `,
//   {});
//
registerFile(FACILITY_CONTROLLER);
