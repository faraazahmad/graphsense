import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

export async function getQueryKeys(query: string) {
    const prompt = `
        Given this cypher query: ${query}
        for my neo4j DB that has the following labels and relationships:
        (File)-[:IMPORTS_FROM]->(File)
        (Function)-[:CALLS]->(Function)

        where:
            Function has 2 keys: name and path
            File has one key: path (same one used in Function)
            IMPORTS_FROM has a value 'clause' which declares which function has been imported

        Return query variables present in the query. categorize and return json.
    `;

    // const googleAI = createGoogleGenerativeAI({
    //     apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'],
    // });
    // const gemini = googleAI('gemini-2.0-flash-lite-preview-02-05');
    const claude = anthropic('claude-3-5-sonnet-latest');
    const { text } = await generateText({ model: claude, prompt });
    return text;
}

export async function plan(query: string, error?: Error) {
    const prompt = `
        You are an expert Cypher query generator for a Neo4j database with the following schema and requirements:

        Database schema:
        - Nodes:
          - (File) nodes have a 'path' property (string).
          - (Function) nodes have 'name' (string) and 'path' (string) properties.
        - Relationships:
          - (File)-[:IMPORTS_FROM { clause: string }]->(File)
            * The 'clause' property indicates the name of the function imported.
          - (Function)-[:CALLS]->(Function)

        Task:
        - Given a natural language user query, generate a precise Cypher query that:
          1. Matches nodes relevant to the query.
          2. Finds and returns **all relationships between the matched nodes**.
          3. Assigns variables to all matched nodes and relationships for clarity.
          4. Avoids syntax errors and incomplete or partial results.
          5. Returns the matched nodes and relationships explicitly.

        Important notes:
        - When matching functions, use both 'name' and 'path' if specified in the query.
        - When matching files, use 'path' property.
        - The IMPORTS_FROM relationship's 'clause' property should be used to filter by imported function name.
        - Ensure that queries are optimized and do not miss any relevant relationships between matched nodes.

        Examples:

        1. Query: "Which functions are called by internalSyncCustomerWallet?"
        Cypher:
        MATCH (caller:Function {name: "internalSyncCustomerWallet"})-[rel:CALLS]->(callee:Function)
        RETURN caller, callee, rel

        2. Query: "Which files import a function named round?"
        Cypher:
        MATCH (importer:File)-[rel:IMPORTS_FROM {clause: "round"}]->(importee:File)
        RETURN importer, importee, rel

        3. Query: "Show all functions and files related to the function 'processOrder' including their calls and imports."
        Cypher:
        MATCH (f:Function {name: "processOrder"})
        OPTIONAL MATCH (f)-[callRel:CALLS]->(calledFunc:Function)
        OPTIONAL MATCH (file:File {path: f.path})-[importRel:IMPORTS_FROM]->(importedFile:File)
        RETURN f, callRel, calledFunc, file, importRel, importedFile

        ${error ? 'Please avoid this error in the query: ' + error.message : ''}

        Generate a complete, error-free Cypher query based on the following user prompt: "${query}"

        Return only the query code
        `

    const googleAI = createGoogleGenerativeAI({
        apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'],
    });
    const gemini = googleAI('gemini-2.0-flash-lite-preview-02-05');
    // const claude = anthropic('claude-3-5-sonnet-latest');
    const { text } = await generateText({ model: gemini, prompt });
    return text;
}
