CREATE TABLE IF NOT EXISTS functions (
    id varchar(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    path varchar(255) NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    parsed timestamp,
    summary TEXT,
    embedding VECTOR(1024)
);
