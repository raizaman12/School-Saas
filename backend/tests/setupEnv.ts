import dotenv from 'dotenv';
import path from 'path';

// Load .env.test explicitly so `npm test` never accidentally points at the
// development database.
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });
