import "dotenv/config";
import { MongoClient } from "mongodb";
const uri =
  process.env.MONGO_URI ||
  `mongodb+srv://${process.env.DB_USER}:${encodeURIComponent(process.env.DB_PASSWORD || "")}@cluster0.xmw7zrv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri);
let database;
export async function connectDB() {
  await client.connect();
  database = client.db(process.env.DB_NAME || "homies_v2");
  await database
    .collection("rooms")
    .createIndex({ roomId: 1 }, { unique: true });
  await database.collection("users").createIndex({ uid: 1 }, { unique: true });
  await database
    .collection("meals")
    .createIndex({ roomId: 1, uid: 1, date: 1 }, { unique: true });
  await database
    .collection("deposits")
    .createIndex({ roomId: 1, month: 1, uid: 1 }, { unique: true });
  await database
    .collection("demands")
    .createIndex({ roomId: 1, month: 1 }, { unique: true });
  // one room per user: a user id may appear in only one room's members list
  await database
    .collection("rooms")
    .createIndex({ members: 1 }, { unique: true })
    .catch((e) =>
      console.warn(
        "Skipped one-room-per-user index (old test data conflicts):",
        e.message,
      ),
    );
  console.log("MongoDB connected");
}
export const db = () => database;
