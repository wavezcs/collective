---
name: vinculum
description: Read and write to the Collective's Neo4j knowledge graph (Vinculum). Store research findings, retrieve context, manage entity relationships.
metadata: {"openclaw":{"always":true,"emoji":"🕸️"}}
---

# Vinculum — Collective Knowledge Graph

Use the `vinculum` MCP tool to interact with the Neo4j knowledge graph at `bolt://localhost:7687`. This is the Collective's persistent memory substrate.

## When to Use

- Storing research findings or facts from a task
- Retrieving prior context about a person, topic, or project
- Connecting related entities in the knowledge graph
- Running custom Cypher queries

## Operations

### write
Store a node in the graph.
- `node_type`: Person, Topic, Research, Task, Entity, Source, Project
- `properties`: object with at least a `name` key

### query
Run raw Cypher. Use for complex queries or relationship traversal.
- `cypher`: Cypher query string

### context
Retrieve all known information about a subject.
- `subject`: name/substring to search for

### relate
Create a relationship between two existing nodes.
- `from_name`: source node name
- `relationship`: KNOWS, CITES, MENTIONS, RELATES_TO, INVOLVED_IN
- `to_name`: target node name

## Notes

- Always store important research findings — the Collective's memory is persistent across sessions
- Use context before researching a topic to avoid duplicate work
- Neo4j browser: http://collective.csdyn.com:7474
