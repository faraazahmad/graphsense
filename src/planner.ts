import { anthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI, google } from '@ai-sdk/google';
import { generateText } from 'ai';

export async function makeQueryDecision(query: string) {
    const prompt = `
        You are an expert system architect with deep knowledge of both graph databases (Neo4j) and vector search in relational databases (Postgres with pgvector). Given the following data schemas:

    Neo4j Database:
    - Nodes:
      - File nodes with a 'path' property (string).
      - Function nodes with 'name' (string) and 'path' (string) properties.
    - Relationships:
      - (File)-[:IMPORTS_FROM { clause: string }]->(File), where 'clause' indicates the name of the function imported.
      - (Function)-[:CALLS]->(Function)

    Postgres Database with pgvector:
    - Table 'functions' with columns:
      - id (varchar, primary key)
      - name (varchar)
      - code (text)
      - summary (text)
      - embedding (vector(768)) for semantic vector search

    Your task is: Given a user query about functions or code, decide whether to run a vector search on the Postgres 'functions' table or to query the Neo4j graph database.

    Consider these guidelines to maximize recall and expert decision-making:

    1. If the user query is a natural language description or question aiming to find functions by meaning, similarity in code, or summary, prioritize vector search on the Postgres 'functions' table using embeddings.

    2. If the user query involves structural relationships such as:
       - Which functions call a given function?
       - What files import a particular function?
       - What is the call hierarchy or dependency graph?
       then prioritize querying the Neo4j graph database to leverage its relationship traversal capabilities.

    3. For queries combining semantic intent with structural constraints (e.g., find functions semantically related to X but only within files imported by Y), use vector search to find candidate functions by semantic similarity.

    4. When the query is ambiguous or broad, prefer vector search to maximize recall.

    5. Always weigh the nature of the query: semantic similarity and unstructured text → Postgres vector search; structural, relational, or dependency navigation → Neo4j graph queries.

    Prepare a simple reasoning to explain the decision to the user, they should not be made aware of the databases being used, there's no need to repeat the query.

    Provide your decision and reason in a json response, like this: { reason: string, decision: string<'sql' | 'neo4j'>}. When the decision is sql, also give a one line description for me to use in the vector search, call that column summary. 

    Generate for this query: "${query}"
    `;
    const claude = anthropic('claude-3-5-sonnet-latest');
    const gemini = google('gemini-2.0-flash-lite-preview-02-05');
    const { text } = await generateText({ model: gemini, prompt });
    console.log(text);
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
