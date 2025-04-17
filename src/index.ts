import { createSourceFile, forEachChild, FunctionDeclaration, Node, ScriptTarget, SyntaxKind } from 'typescript';
import { resolve } from 'node:path';
import { globSync, readFileSync } from 'node:fs';
import { executeQuery } from './db';
import { ollama } from 'ollama-ai-provider';
import { Client } from 'pg';
import { createGoogleGenerativeAI, google } from '@ai-sdk/google';
import 'dotenv/config';
import { generateText } from 'ai';

let parseIndex = 0;
const functionParseQueue: Array<any> = [];

interface ImportData {
    clause: string
    source: string
}

const pgClient = new Client({
    user: 'user',
    password: 'password',
    database: 'postgres',
    port: 5432
});

executeQuery(`
    CREATE CONSTRAINT file_path_unique IF NOT EXISTS
    FOR (f:File)
    REQUIRE (f.name, f.path) IS UNIQUE
`, {});

executeQuery(`
    CREATE CONSTRAINT function_name_path_unique IF NOT EXISTS
    FOR (f:Function)
    REQUIRE (f.name, f.path) IS UNIQUE
`, {});

pgClient.connect()
    .then(() => console.log('Connected to Postgres'))
    .catch((err) => `Error connecting to Postgres: ${err}`);

const embeddingModel = ollama('nomic-embed-text');

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
        // const importDeclaration = node as ImportDeclaration;
        // const importData = {
        //     clause: "",
        //     source: "",
        // } as ImportData;
        //
        // forEachChild(node, (child) => {
        //     if (child.kind === SyntaxKind.StringLiteral) {
        //         let path;
        //         const text = child.getText();
        //         if (text.includes('./')) {
        //             let rawPath = `${dirname(filePath)}/${text.slice(1, text.length - 1)}`;
        //             if (rawPath.includes('./') && !(rawPath.endsWith('.js') || rawPath.endsWith('.json'))) { rawPath += '.js'; }
        //             path = resolve(rawPath);
        //         } else {
        //             path = text.slice(1, text.length - 1);
        //         }
        //
        //         importData.source = path;
        //     }
        // });
        //
        // if (importDeclaration.importClause?.namedBindings) {
        //     const namedBindings = importDeclaration.importClause.namedBindings;
        //
        //     // Check if named bindings are NamedImports
        //     if (namedBindings.kind === SyntaxKind.NamedImports) {
        //         const namedImports = namedBindings as NamedImports;
        //
        //         // Access each element in NamedImports
        //         namedImports.elements.forEach(element => {
        //             result.push({ clause: element.name.text, source: importData.source });
        //         });
        //     }
        // } else if (importDeclaration.importClause?.name) {
        //     importData.clause = importDeclaration.importClause.name.getText();
        //     result.push(importData);
        // }
    } else if (node.kind === SyntaxKind.FunctionDeclaration) {
        let skipFunction = false;

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

            functionParseQueue.push(functionNode);
            console.log(`[${new Date().toUTCString()}]: Pushed function ${functionNode.name?.escapedText} to processing queue`)
        });
    }
    return result;
}

async function parseFunctionDeclaration(node: FunctionDeclaration) {
    console.log(`[${new Date().toUTCString()}]: Started parsing ${node.name?.escapedText}()`);



    // Generate function embeddings
    const model = ollama.embedding(embeddingModel.modelId);
    const googleAI = createGoogleGenerativeAI({
        apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'],
    });
    const gemini = googleAI('gemini-2.0-flash-lite-preview-02-05');
    // const deepseek = ollama('deepseek-r1:1.5b');
    const { text } = await generateText({
        model: gemini,
        prompt: `Given the following function body, generate a summary for it: \`\`\`${node.getText()}\`\`\``
    });
    const summary = text.replace(new RegExp("<think>.*</think>"), "");

    let fileId;
    executeQuery(`
      MERGE (function:Function {name: $name, path: $path}) return elementId(function) as id
      `,
        { path: node.getSourceFile().fileName, name: node.name?.escapedText })
        .then(async (result) => {
            fileId = result.records.map(rec => rec.get('id'));
            try {
                const fxn = await pgClient.query(
                    `select id from functions where id = $1 limit 1`,
                    [fileId[0]]
                );
                if (fxn.rows.length) { return; }
            } catch (err: any) {
                console.error(err.message);
                return;
            }
            const embedResult = await model.doEmbed({
                values: [summary]
            });
            try {
                await pgClient.query(
                    `
INSERT INTO functions (id, name, embedding)
VALUES ($1, $2, $3)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    embedding = EXCLUDED.embedding;
                    `,
                    [fileId[0], node.name?.escapedText, JSON.stringify(embedResult.embeddings[0])]
                );
                console.log(`[${new Date().toUTCString()}]: Parsed function: ${node.name?.escapedText}`)
            } catch (err) {
                console.error(err);
            }
        })
        .catch(err => console.error(err));
}

function registerFile(path: string) {
    let results: ImportData[] = [];
    if (!(path[0] === '/')) { return results; }

    results = parseFile(path, []);

    executeQuery(`
      MERGE (file:File {path: $path})
      `,
        { path: path })
        .catch(err => console.error(err));

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

const REPO_PATH = `${resolve('.')}/rs-admin-api`;
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

async function parseTopFunctionNode() {
    const functionNode = functionParseQueue[parseIndex];
    if (!functionNode) { return; }

    await parseFunctionDeclaration(functionNode);
    parseIndex += 1;
}

setInterval(() => {
    parseTopFunctionNode();
}, 5 * 1000);
