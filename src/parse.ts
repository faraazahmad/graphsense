import { ImportDeclaration, NamedImports, isCallExpression, isIdentifier, isPropertyAccessExpression, createSourceFile, forEachChild, FunctionDeclaration, Node, ScriptTarget, SyntaxKind } from 'typescript';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { ollama } from 'ollama-ai-provider';
import { generateText } from 'ai';
import { executeQuery, pgClient } from './db';

const embeddingModel = ollama('nomic-embed-text');

export async function parseFunctionDeclaration(node: FunctionDeclaration, reParse = false) {
    // console.log(`[${new Date().toUTCString()}]: Started parsing ${node.name?.escapedText}`);
    //
    //     // Generate function embeddings
    //     const model = ollama.embedding(embeddingModel.modelId);
    //     const googleAI = createGoogleGenerativeAI({
    //         apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'],
    //     });
    //     const gemini = googleAI('gemini-2.0-flash-lite-preview-02-05');
    //     // const deepseek = ollama('deepseek-r1:1.5b');
    //     const { text } = await generateText({
    //         model: gemini,
    //         prompt: `Given the following function body, generate a highly technical, information-dense summary for it: \`\`\`${node.getText()}\`\`\``
    //     });
    //     const summary = text.replace(new RegExp("<think>.*</think>"), "");
    //
    //     let fileId;
    //     executeQuery(`
    //       MERGE (function:Function {name: $name, path: $path}) return elementId(function) as id
    //       `,
    //         { path: node.getSourceFile().fileName, name: node.name?.escapedText })
    //         .then(async (result) => {
    //             fileId = result.records.map(rec => rec.get('id'));
    //             if (!reParse) {
    //                 try {
    //                     const fxn = await pgClient.query(
    //                         `select id from functions where id = $1 limit 1`,
    //                         [fileId[0]]
    //                     );
    //                     if (fxn.rows.length) { return; }
    //                 } catch (err: any) {
    //                     console.error(err.message);
    //                     return;
    //                 }
    //             }
    //             const embedResult = await model.doEmbed({ values: [summary] });
    //             try {
    //                 await pgClient.query(
    //                     `
    // INSERT INTO functions (id, name, code, summary, embedding)
    // VALUES ($1, $2, $3, $4, $5)
    // ON CONFLICT (id) DO UPDATE
    // SET name = EXCLUDED.name,
    // code = EXCLUDED.code,
    // summary = EXCLUDED.summary,
    // embedding = EXCLUDED.embedding;
    //                     `,
    //                     [fileId[0], node.name?.escapedText, node.getText(), summary, JSON.stringify(embedResult.embeddings[0])]
    //                 );
    //                 console.log(`[${new Date().toUTCString()}]: Parsed function: ${node.name?.escapedText}`)
    //             } catch (err) {
    //                 console.error(err);
    //             }
    //         })
    //         .catch(err => console.error(err));

    // Recursively visit each child to capture function calls from this node
    const extractFunctionCalls = (rootFunction: FunctionDeclaration, node: Node) => {
        if (isCallExpression(node) && isIdentifier(node.expression)) {
            const name = node.expression.escapedText.toString();
            callSet.add(name);
        }

        forEachChild(node, (child: Node) => extractFunctionCalls(rootFunction, child));
    }

    const callSet = new Set<string>();
    forEachChild(node, (child: Node) => extractFunctionCalls(node, child));

    if (!Array.from(callSet).length) { return; }
    addCallsRelation(node.name!.getText(), node.getSourceFile().fileName, callSet);
}

async function addCallsRelation(caller: string, callerPath: string, callees: Set<string>) {
    // console.log(`Function ${node.name?.getText()} calls ${functionCall}`);
    // Check if caller sourceFile imports callee function, search for all functions at once
    // For all imported callees, Add :CALLS relation between the functions

    for (const callee of callees) {
        const result = await executeQuery(
            `
            match (importer:File { path: $path })-[importReln:IMPORTS_FROM]->(importee:File)
            where importReln.clause = $callee
            return importee.path as destination;
            `,
            { path: callerPath, callee: callee }
        );
        if (!result.records.length) { continue; }

        const destinationPath = result.records.map(rec => rec.get('destination'))[0]
        executeQuery(
        `
         match (caller:Function { name: $callerName, path: $callerPath }), (callee:Function { name: $calleeName, path: $calleePath })
         merge (caller)-[:CALLS]->(callee)
        `,
        { callerName: caller, callerPath: callerPath, calleeName: callee, calleePath: destinationPath });
    }
}
