// import "dotenv/config";
// process.env.tz ||= "Asia/Dhaka";
// import express from "express";
// import cors from "cors";
// import { connectDB } from "./db.js";
// import market from "./routes/market.js";
// import api from "./routes/rooms.js";
// import search from "./routes/search.js";

// const app = express();
// app.use(cors({ origin: process.env.CLIENT_URL || true }));
// app.use(express.json({ limit: "8mb" })); // posts carry small base64 photos
// app.get("/", (_, res) => res.send("HOMIES API running"));
// app.use("/api", market); // must come before the rooms router
// app.use("/api", api);
// app.use("/api", search);

// connectDB()
//   .then(() =>
//     app.listen(process.env.PORT || 5000, () =>
//       console.log("Server on", process.env.PORT || 5000),
//     ),
//   )
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   });




import 'dotenv/config';
process.env.TZ = 'Asia/Dhaka'; // "today" rolls over at Dhaka midnight, not UTC
import express from 'express';
import cors from 'cors';
import { connectDB } from './db.js';
import market from './routes/market.js';
import search from './routes/search.js';
import api from './routes/rooms.js';

const app = express();

// CLIENT_URL can hold several addresses separated by commas
const allowed = (process.env.CLIENT_URL || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => cb(null, !origin || !allowed.length || allowed.includes(origin) || origin === 'http://localhost:5173'),
}));
app.use(express.json({ limit: '4mb' })); // Vercel rejects request bodies over 4.5 MB

app.get('/', (_, res) => res.send('HOMIES API running'));

// Connect to MongoDB once and reuse the connection between requests
app.use(async (_req, res, next) => {
  try { await connectDB(); next(); }
  catch (e) { console.error(e); res.status(500).json({ message: 'Database unavailable' }); }
});

app.use('/api', market);
app.use('/api', search);
app.use('/api', api);

// Vercel runs the app itself. Only listen on a port when running locally.
if (!process.env.VERCEL) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log('Server on', port));
}

export default app;