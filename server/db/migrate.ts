import { sqlite } from "./database.js";
const versions = sqlite.reader.prepare("SELECT version,name,applied_at FROM schema_migrations ORDER BY version").all();
console.log(JSON.stringify({ database: sqlite.path, migrations: versions }, null, 2)); sqlite.close();
