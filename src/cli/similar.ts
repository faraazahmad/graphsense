import { setupDB } from "../db";
import { getSimilarFunctions } from "../mcp";

async function runSimilar(description: string) {
  try {
    const { functions, totalTokens } = await getSimilarFunctions(description);

    if (!functions.length) {
      console.log("No similar functions found.");
      return;
    }

    console.log(`Found ${functions.length} similar functions:\n`);

    functions.forEach((func, index) => {
      console.log(
        `${index + 1}. **${func.name}**\n` +
          `   - Path: ${func.path}:${func.start_line}-${func.end_line}\n` +
          `   - Summary: ${func.summary}\n` +
          `   - Score: ${func.similarity_score.toFixed(3)}\n`,
      );
    });

    console.log(`Total tokens used for LLM validation: ${totalTokens}`);
  } catch (error) {
    console.error("Error finding similar functions:", error);
    process.exit(1);
  }
}

const description = process.argv[2];

if (require.main === module) {
  setupDB().then(() => runSimilar(description));
}
