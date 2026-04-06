# use-vinculum

Read and write to the Collective's Neo4j knowledge graph (Vinculum) for persistent memory across sessions.

## When to use
- Before answering personal or context-dependent questions (read first)
- After completing research to store findings for future sessions
- When the user references something that should be remembered
- When building on prior knowledge about the user, their family, or ongoing projects

## Operations

Use the collective__vinculum MCP tool:

### Store a fact or entity
```
tool: collective__vinculum
args:
  operation: write
  node_type: Person | Project | Preference | Event | Fact
  properties:
    name: "<unique identifier>"
    <other properties as key-value pairs>
```

### Look up context on a topic
```
tool: collective__vinculum
args:
  operation: context
  subject: "<name or keyword to search>"
```

### Run a custom Cypher query
```
tool: collective__vinculum
args:
  operation: query
  cypher: "MATCH (n:Person) WHERE n.name = 'Alice' RETURN n"
```

### Create a relationship between nodes
```
tool: collective__vinculum
args:
  operation: relate
  from_name: "<node A name>"
  relationship: "KNOWS | WORKS_ON | PREFERS | RELATED_TO"
  to_name: "<node B name>"
```

## Notes
- Neo4j is at bolt://localhost:7687 on collective.csdyn.com
- Always call context before personal tasks to check what's known
- Write findings after research so they persist across sessions
