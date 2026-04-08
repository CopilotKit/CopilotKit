import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;

const sql = connectionString
  ? postgres(connectionString, { max: 5, idle_timeout: 20 })
  : null;

export default sql;
