const { Pool } = require('pg');
const config = require('./config');

if (config.disableDatabase) {
  async function query() {
    return { rows: [], rowCount: 0 };
  }

  async function withTransaction(work) {
    const fakeClient = { query };
    return work(fakeClient);
  }

  module.exports = {
    pool: null,
    query,
    withTransaction,
  };
} else {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    ssl: process.env.PGSSLMODE === 'disable' ? false : undefined,
  });

  async function query(text, params = []) {
    return pool.query(text, params);
  }

  async function withTransaction(work) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  module.exports = {
    pool,
    query,
    withTransaction,
  };
}
