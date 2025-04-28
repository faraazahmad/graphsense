import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { pgClient, executeQuery, setupDB } from './db';
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

    const googleAI = createGoogleGenerativeAI({
        apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'],
    });
    const gemini = googleAI('gemini-2.0-flash-lite-preview-02-05');
    const { text } = await generateText({ model: gemini, prompt });
    return text;
}

export async function plan(query: string, error?: Error) {
    // const prompt = `
    //     Here's some context for the neo4j database:
    //
    //     My neo4j DB has the following labels and relationships:
    //     (File)-[:IMPORTS_FROM]->(File)
    //     (Function)-[:CALLS]->(Function)
    //
    //     where:
    //         Function has 2 keys: name and path
    //         File has one key: path (same one used in Function)
    //         IMPORTS_FROM has a value 'clause' which declares which function has been imported
    //
    //     Set variables for all nodes and relationships, return all variables.
    //
    //     ${error ? 'Avoid this error in the query: ' + error.message : ''}
    //     Generate a Cypher query based on the following prompt: "${query}"
    // `;
    const prompt = `
    Here's some context for the Neo4j database:

    My Neo4j DB has the following labels and relationships:
      (File)-[:IMPORTS_FROM]->(File)
      (Function)-[:CALLS]->(Function)

    Details:
    - Function nodes have two properties: 'name' and 'path'.
    - File nodes have one property: 'path' (the same key used in Function).
    - The IMPORTS_FROM relationship has a property 'clause' indicating which function was imported.

    Instructions:
    - Match nodes based on the user query.
    - For all matched nodes, find and include **all relationships between them**.
    - Assign variables to **all nodes and relationships** involved.
    - Return all these variables explicitly in the query.
    - Ensure the query returns a complete subgraph of nodes and all their connecting relationships.
    - Avoid errors or incomplete results.

    example: MATCH (caller:Function {name: "internalSyncCustomerWallet"})-[rel:CALLS]->(callee:Function) RETURN caller, callee, rel

    ${error ? 'Avoid this error in the query: ' + error.message : ''}

    Generate a Cypher query based on the following prompt: "${query}"
    `;

    const googleAI = createGoogleGenerativeAI({
        apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'],
    });
    const gemini = googleAI('gemini-2.0-flash-lite-preview-02-05');
    const { text } = await generateText({ model: gemini, prompt });
    return text;
}
