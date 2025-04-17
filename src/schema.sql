CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE if not exists functions (
    id varchar(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    embedding vector(768) -- Vector column for embeddings
);
