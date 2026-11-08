// import 'dotenv/config';
// process.env.TZ ||= 'Asia/Dhaka';
// import express from 'express';
// import cors from 'cors';
// import { connectDB } from './db.js';
// import api from './routes/rooms.js';
// const app = express();
// app.use(cors({ origin: process.env.CLIENT_URL || true }));
// app.use(express.json());
// app.get('/', (_, res) => res.send("HOMIES API running"));
// app.use('/api', api);
// connectDB().then(() => app.listen(process.env.PORT || 5000, () => console.log('Server on', process.env.PORT || 5000)))
//   .catch((e) => { console.error(e); process.exit(1); });



import 'dotenv/config';
process.env.TZ ||= 'Asia/Dhaka';
import express from 'express';
import cors from 'cors';
import { connectDB } from './db.js';
import market from './routes/market.js';
import api from './routes/rooms.js';
import search from './routes/search.js';

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || true }));
app.use(express.json({ limit: '8mb' })); // posts carry small base64 photos
app.get('/', (_, res) => res.send('HOMIES API running'));
app.use('/api', market); // must come before the rooms router
app.use('/api', api);
app.use('/api', search);


connectDB()
  .then(() => app.listen(process.env.PORT || 5000, () => console.log('Server on', process.env.PORT || 5000)))
  .catch((e) => { console.error(e); process.exit(1); });