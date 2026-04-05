/**
 * Neo4j Memory Skill — Vinculum's interface to the knowledge graph
 *
 * Provides drones with read/write access to the Collective's
 * persistent knowledge graph via Neo4j.
 */

const neo4j = require('neo4j-driver');
const path = require('path');
const fs = require('fs');

const CONFIG_PATH = path.join(__dirname, '../../config/collective.json');

let _driver = null;

function getDriver() {
  if (_driver) return _driver;
  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD } = config.GENERAL;
  _driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  return _driver;
}

module.exports = {
  name: 'vinculum',
  description: 'Read and write to the Collective\'s Neo4j knowledge graph (Vinculum). Store research findings, retrieve context, manage relationships between entities.',

  parameters: {
    type: 'object',
    properties: {
      operation: {
        type: 'string',
        enum: ['write', 'query', 'context', 'relate'],
        description: 'Operation: write (store node), query (semantic search), context (get all about subject), relate (create relationship)'
      },
      cypher: {
        type: 'string',
        description: 'For query operation: raw Cypher query to execute'
      },
      node_type: {
        type: 'string',
        description: 'For write: node label (Person, Topic, Research, Task, Entity, Source, Project)'
      },
      properties: {
        type: 'object',
        description: 'For write: node properties as key-value pairs'
      },
      subject: {
        type: 'string',
        description: 'For context: subject name to retrieve all known information about'
      },
      from_name: {
        type: 'string',
        description: 'For relate: name of source node'
      },
      relationship: {
        type: 'string',
        description: 'For relate: relationship type (KNOWS, CITES, MENTIONS, RELATES_TO, INVOLVED_IN)'
      },
      to_name: {
        type: 'string',
        description: 'For relate: name of target node'
      }
    },
    required: ['operation']
  },

  async run({ operation, cypher, node_type, properties, subject, from_name, relationship, to_name }) {
    const driver = getDriver();
    const session = driver.session();

    try {
      switch (operation) {

        case 'write': {
          if (!node_type || !properties) return 'Error: node_type and properties required for write';
          const props = Object.entries(properties)
            .map(([k, v]) => `${k}: $${k}`)
            .join(', ');
          const result = await session.run(
            `MERGE (n:${node_type} {name: $name})
             SET n += {${props}}
             RETURN n`,
            { ...properties }
          );
          return `Vinculum: wrote ${node_type} node "${properties.name || JSON.stringify(properties)}"`;
        }

        case 'query': {
          if (!cypher) return 'Error: cypher query required for query operation';
          const result = await session.run(cypher);
          const records = result.records.map(r => r.toObject());
          return records.length > 0
            ? `Vinculum results:\n${JSON.stringify(records, null, 2)}`
            : 'Vinculum: no matching records found';
        }

        case 'context': {
          if (!subject) return 'Error: subject required for context operation';
          const result = await session.run(
            `MATCH (n) WHERE n.name CONTAINS $subject
             OPTIONAL MATCH (n)-[r]-(related)
             RETURN n, type(r) as rel_type, related LIMIT 50`,
            { subject }
          );
          const records = result.records.map(r => ({
            node: r.get('n').properties,
            relationship: r.get('rel_type'),
            related: r.get('related') ? r.get('related').properties : null
          }));
          return records.length > 0
            ? `Vinculum context for "${subject}":\n${JSON.stringify(records, null, 2)}`
            : `Vinculum: no context found for "${subject}"`;
        }

        case 'relate': {
          if (!from_name || !relationship || !to_name) return 'Error: from_name, relationship, and to_name required';
          await session.run(
            `MATCH (a {name: $from_name}), (b {name: $to_name})
             MERGE (a)-[:${relationship}]->(b)`,
            { from_name, to_name }
          );
          return `Vinculum: created (${from_name})-[:${relationship}]->(${to_name})`;
        }

        default:
          return `Error: unknown operation "${operation}"`;
      }
    } finally {
      await session.close();
    }
  }
};
