import { ImportDeclaration, NamedImports, isCallExpression, isIdentifier, isPropertyAccessExpression, createSourceFile, forEachChild, FunctionDeclaration, Node, ScriptTarget, SyntaxKind, isStringLiteral } from 'typescript';
import { dirname, resolve } from 'node:path';
import { globSync, readFileSync } from 'node:fs';
import { driver, executeQuery, pgClient, setupDB } from './db';
import 'dotenv/config';
import { parseFunctionDeclaration, processFunctionWithAI } from './parse';
import { QueryResult, RecordShape } from 'neo4j-driver';

interface FunctionParseDTO {
    node: FunctionDeclaration,
    result: QueryResult<RecordShape>,
    reParse: boolean,
}

let parseIndex = 0;
export const functionParseQueue: Array<FunctionParseDTO> = [];

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
        if (result) { results = [...results, ...result]; }
    })

    return results;
}

function traverse(filePath: string, node: Node): void | ImportData[] {
    if (node.getChildCount() === 0) { return []; }

    let result: ImportData[] = [];
    if (node.kind === SyntaxKind.ImportDeclaration) {
        const importDeclaration = node as ImportDeclaration;
        const importData = {
            clause: "",
            source: "",
        } as ImportData;

        forEachChild(node, (child) => {
            if (!isStringLiteral(child)) { return; }

            let path;
            const text = child.getText();
            if (text.includes('./')) {
                let rawPath = `${dirname(filePath)}/${text.slice(1, text.length - 1)}`;
                if (rawPath.includes('./') && !(rawPath.endsWith('.js') || rawPath.endsWith('.json'))) { rawPath += '.js'; }
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
                namedImports.elements.forEach(element => {
                    result.push({ clause: element.name.text, source: importData.source });
                });
            }
        } else if (importDeclaration.importClause?.name) {
            importData.clause = importDeclaration.importClause.name.getText();
            result.push(importData);
        }
    } else if (node.kind === SyntaxKind.FunctionDeclaration) {
        const functionNode = node as FunctionDeclaration;
        executeQuery(
            `MATCH (function:Function {name: $name, path: $path}) return elementId(function) as id`,
            { path: node.getSourceFile().fileName, name: functionNode.name?.escapedText }
        )
            .then(async result => {
                const fileId = result.records.map(rec => rec.get('id'));
                const fxn = await pgClient.query(
                    `select id from functions where id = $1 limit 1`,
                    [fileId[0]]
                );
                if (fxn.rows.length) { return; }

                parseFunctionDeclaration(functionNode, false);
            });
    }
    return result;
}

function registerFile(path: string) {
    let results: ImportData[] = [];
    if (!(path[0] === '/')) { return results; }

    results = parseFile(path, []);

    for (const result of results) {
        executeQuery(`
          MERGE (file: File {path: $path})
      `,
            { path: result.source })
            .catch(err => console.error(err));

        executeQuery(`
         match (file1:File { path: $source }), (file2:File { path: $path })
         merge (file1)-[:IMPORTS_FROM { clause: $clause }]->(file2)
      `,
            { source: path, path: result.source, clause: result.clause })
            .catch(err => console.error(err));
    }

    return results;
}

async function parseTopFunctionNode() {
    const functionParseArg = functionParseQueue[parseIndex];
    if (!functionParseArg) { return; }

    const { node, result, reParse } = functionParseArg;
    await processFunctionWithAI(node, result, reParse);
    parseIndex += 1;
}

async function prePass() {
    await setupDB();

    return Promise.resolve();
}

async function passOne() {
    const REPO_PATH = `${resolve('.')}/rs-admin-api`;
    const fileList = globSync(`${REPO_PATH}/**/**/*.js`)

    fileList.forEach(registerFile);

    return Promise.resolve();
}

async function passTwo() {
    setInterval(() => {
        parseTopFunctionNode();
    }, 5 * 1000);

    return Promise.resolve();
}

async function endIndexing() {
    driver.close();
    pgClient.end();
    return Promise.resolve();
}

prePass()
    .then(passOne)
    .then(passTwo)
// .then(endIndexing);
