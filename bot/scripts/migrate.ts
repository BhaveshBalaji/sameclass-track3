import { loadConfig, safeFailure } from '../src/config/index.js';
import { createPool, migrate } from '../src/persistence/database.js';
const pool = createPool(loadConfig());
try { await migrate(pool); console.log('Application and checkpoint migrations applied.'); }
catch (error) { safeFailure('migrations', error); }
finally { await pool.end(); }
