CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);

INSERT INTO users (id, name, email)
SELECT id, name, email
FROM (VALUES
  (1, 'Darpan', 'darpan@example.com'),
  (2, 'John', 'john@example.com')
) AS samples(id, name, email)
WHERE NOT EXISTS (SELECT 1 FROM users);
