import neo4j from 'neo4j-driver';

// Create a driver instance
const driver = neo4j.driver(
  'bolt://localhost:7687', // Replace with your Neo4j instance address
  // neo4j.auth.basic('neo4j', 'password') // Replace with your credentials
);
// driver.getServerInfo().then(info => console.log(info))

// Create a session
const session = driver.session();

async function fetchData() {
  try {
    const result = await session.run('MATCH (n) RETURN n');
    result.records.forEach(record => {
      console.log(record.get('n'));
    });
  } catch (error) {
    console.error('Error fetching data:', error);
  } finally {
    await session.close();
  }
}

export async function executeQuery(query: string, variables: Object) {
    const session = driver.session();
    const result = await session.run(query, variables);
    await session.close();

    return Promise.resolve(result);
}
