CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE if not exists functions (
    id varchar(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    path varchar(255) NOT NULL,
    start_line integer,
    end_line integer,
    summary TEXT,
    embedding vector (1024) -- Vector column for embeddings
);
