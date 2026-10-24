import pg from 'pg';

export function createDatabasePool(connectionString=process.env.DATABASE_URL){
  if(!connectionString)throw new Error('DATABASE_URL must be configured in the server environment.');
  return new pg.Pool({
    connectionString,
    max:5,
    connectionTimeoutMillis:15000,
    idleTimeoutMillis:30000,
    allowExitOnIdle:false
  });
}
