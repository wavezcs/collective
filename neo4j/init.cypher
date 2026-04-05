// Vinculum — Neo4j Knowledge Graph Schema Initialization
// Run once after Neo4j install: cypher-shell < neo4j/init.cypher

// Constraints (uniqueness + existence)
CREATE CONSTRAINT person_name IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE;
CREATE CONSTRAINT topic_name IF NOT EXISTS FOR (t:Topic) REQUIRE t.name IS UNIQUE;
CREATE CONSTRAINT project_name IF NOT EXISTS FOR (p:Project) REQUIRE p.name IS UNIQUE;
CREATE CONSTRAINT source_url IF NOT EXISTS FOR (s:Source) REQUIRE s.url IS UNIQUE;

// Indexes for search performance
CREATE INDEX person_notes IF NOT EXISTS FOR (p:Person) ON (p.notes);
CREATE INDEX topic_domain IF NOT EXISTS FOR (t:Topic) ON (t.domain);
CREATE INDEX research_date IF NOT EXISTS FOR (r:Research) ON (r.date);
CREATE INDEX task_status IF NOT EXISTS FOR (t:Task) ON (t.status);
CREATE INDEX task_due IF NOT EXISTS FOR (t:Task) ON (t.due_date);
CREATE INDEX entity_type IF NOT EXISTS FOR (e:Entity) ON (e.type);

// Seed: The Collective itself
MERGE (c:Entity {name: 'The Collective'})
SET c += {type: 'system', description: 'The Borg Collective — AI research crew and personal assistant', created: datetime()};

MERGE (locutus:Entity {name: 'Locutus'})
SET locutus += {type: 'drone', role: 'orchestrator', model: 'hermes2pro'};

MERGE (seven:Entity {name: 'Seven'})
SET seven += {type: 'drone', role: 'research', model: 'llama3-10k'};

MERGE (data_drone:Entity {name: 'Data'})
SET data_drone += {type: 'drone', role: 'technical', model: 'qwen2.5-coder:14b'};

MERGE (hugh:Entity {name: 'Hugh'})
SET hugh += {type: 'drone', role: 'personal_assistant', model: 'hermes2pro'};

MERGE (one:Entity {name: 'One'})
SET one += {type: 'external', role: 'specialist_consultant', system: 'claude-code', host: 'claude.csdyn.com'};

// Drone relationships
MATCH (c:Entity {name: 'The Collective'})
MATCH (l:Entity {name: 'Locutus'})
MATCH (s:Entity {name: 'Seven'})
MATCH (d:Entity {name: 'Data'})
MATCH (h:Entity {name: 'Hugh'})
MATCH (o:Entity {name: 'One'})
MERGE (c)-[:CONTAINS]->(l)
MERGE (c)-[:CONTAINS]->(s)
MERGE (c)-[:CONTAINS]->(d)
MERGE (c)-[:CONTAINS]->(h)
MERGE (l)-[:CONSULTS]->(o);
