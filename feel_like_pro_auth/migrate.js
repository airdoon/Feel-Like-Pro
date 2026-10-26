require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
pool.query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'))
  .then(() => console.log('Schema ready'))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => pool.end());
