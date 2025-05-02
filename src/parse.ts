import { ImportDeclaration, NamedImports, isCallExpression, isIdentifier, isPropertyAccessExpression, createSourceFile, forEachChild, FunctionDeclaration, Node, ScriptTarget, SyntaxKind } from 'typescript';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { ollama } from 'ollama-ai-provider';
import { embed, generateText } from 'ai';
import { executeQuery, pc, pgClient, vectorNamespace } from './db';
import { RecordShape, QueryResult } from 'neo4j-driver';
import { cleanPath, functionParseQueue } from '.';
import { DenseEmbedding } from '@pinecone-database/pinecone/dist/pinecone-generated-ts-fetch/inference';

const embeddingModel = ollama('nomic-embed-text');

export async function parseFunctionDeclaration(node: FunctionDeclaration, reParse = false) {
    const callSet = new Set<string>();
    // Recursively visit each child to capture function calls from this node
    const extractFunctionCalls = (rootFunction: FunctionDeclaration, node: Node) => {
        if (isCallExpression(node) && isIdentifier(node.expression)) {
            const name = node.expression.escapedText.toString();
            callSet.add(name);
        }

        forEachChild(node, (child: Node) => extractFunctionCalls(rootFunction, child));
    }

    executeQuery(`
          MERGE (function:Function {name: $name, path: $path}) return elementId(function) as id
          `,
        { path: cleanPath(node.getSourceFile().fileName), name: node.name?.escapedText })
        .then(async (result) => {
            functionParseQueue.push({ node, result, reParse });
            console.log(`[${new Date().toUTCString()}]: Pushed function ${node.name?.escapedText} to processing queue`);
            forEachChild(node, (child: Node) => extractFunctionCalls(node, child));

            if (!Array.from(callSet).length) { return; }
            addCallsRelation(node.name!.getText(), node.getSourceFile().fileName, callSet);
        })
        .catch(err => console.error(err));

}

export async function processFunctionWithAI(node: FunctionDeclaration, result: QueryResult<RecordShape>, reParse: boolean) {
    console.log(`[${new Date().toUTCString()}]: Started parsing ${node.name?.escapedText}`);

    // const model = ollama.embedding(embeddingModel.modelId);
    const googleAI = createGoogleGenerativeAI({ apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'] });
    const gemini = googleAI('gemini-2.0-flash-lite-preview-02-05');

    const fileId = result.records.map(rec => rec.get('id'));
    if (!reParse) {
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
    }
    const { text } = await generateText({
        model: gemini,
        prompt: `Given the following function body, generate a highly technical, information-dense summary for it: \`\`\`${node.getText()}\`\`\``
    });
    const summary = text.replace(new RegExp("<think>.*</think>"), "");
    // const embedResult = await model.doEmbed({ values: [summary] });
    const embedResult = await pc.inference.embed('llama-text-embed-v2', [summary], { input_type: 'passage' });
    try {
        await pgClient.query(
            `
    INSERT INTO functions (id, name, code, summary)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id) DO UPDATE
    SET name = EXCLUDED.name,
    code = EXCLUDED.code,
    summary = EXCLUDED.summary;
                        `,
            [fileId[0], node.name?.escapedText, node.getText(), summary]
        );
        const embedData: DenseEmbedding = embedResult.data[0] as DenseEmbedding;
        await vectorNamespace.upsert([{ id: fileId[0], values: embedData.values }]);
        console.log(`[${new Date().toUTCString()}]: Parsed function: ${node.name?.escapedText}`)
    } catch (err) {
        console.error(err);
    }
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
            { path: cleanPath(callerPath), callee: callee }
        );
        if (!result.records.length) { continue; }

        const destinationPath = result.records.map(rec => rec.get('destination'))[0]
        executeQuery(
            `
         match (caller:Function { name: $callerName, path: $callerPath }), (callee:Function { name: $calleeName, path: $calleePath })
         merge (caller)-[:CALLS]->(callee)
        `,
            { callerName: caller, callerPath: cleanPath(callerPath), calleeName: callee, calleePath: cleanPath(destinationPath) });
    }
}
