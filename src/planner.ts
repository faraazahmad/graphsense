import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { pgClient, executeQuery, setupDB } from './db';
import { generateText } from 'ai';

export async function plan(query: string) {
    const prompt = `
        Generate a Cypher query based on the following prompt:
        "${query}"
        return all the nodes, return relationships only if query deals with relation between nodes

        Here's some context for the neo4j database:

        neo4j DB has the following labels and relationships:
        (File)-[:IMPORTS_FROM]->(File)
        (Function)-[:CALLS]->(Function)

        where:
            Function has 2 keys: name and path
            File has one key: path (same one used in Function)
            IMPORTS_FROM has a value 'clause' which declares which function has been imported

    `;

    const googleAI = createGoogleGenerativeAI({
        apiKey: process.env['GOOGLE_GENERATIVE_AI_API_KEY'],
    });
    const gemini = googleAI('gemini-2.0-flash-lite-preview-02-05');
    const { text } = await generateText({ model: gemini, prompt });
    return text;

    // const result = await executeQuery(prompt, {});
    // return result.records;
}
