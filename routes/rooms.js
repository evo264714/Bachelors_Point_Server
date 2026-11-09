import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { ObjectId } from "mongodb";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";

const r = Router();
r.use(requireAuth);

const pad = (n) => String(n).padStart(2, "0");
const month = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const today = () => `${month()}-${pad(new Date().getDate())}`;
const w = (fn) => (req, res, next) =>
  fn(req, res, next).catch((e) => {
    console.error(e);
    res.status(500).json({ message: "Server error" });
  });
const col = (n) => db().collection(n);
const num = (v) => Math.max(0, Number(v) || 0);

// ---------- users ----------
r.post(
  "/users/sync",
  w(async (req, res) => {
    const name = req.body.name || req.user.name;
    await col("users").updateOne(
      { uid: req.user.uid },
      { $set: { name, email: req.user.email } },
      { upsert: true },
    );
    res.json({ ok: true });
  }),
);

// ---------- rooms: create / join / list ----------
r.post(
  "/rooms",
  w(async (req, res) => {
    const { name, address, mealPerDay, phone, password, capacity, listed } =
      req.body;
    if (!name || !address || !phone || !password || password.length < 4)
      return res
        .status(400)
        .json({ message: "All fields required (password min 4 chars)" });
    const cap = Math.floor(Number(capacity));
    if (!(cap >= 2 && cap <= 100))
      return res
        .status(400)
        .json({ message: "Members needed must be between 2 and 100" });
    if (
      await col("rooms").findOne(
        { members: req.user.uid },
        { projection: { _id: 1 } },
      )
    )
      return res.status(400).json({
        message: "You are already in a room. Leave it before creating another.",
      });
    const roomId = "BP-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    try {
      await col("rooms").insertOne({
        roomId,
        name,
        address,
        phone,
        mealPerDay: num(mealPerDay) || 2,
        capacity: cap,
        listed: listed !== false,
        passwordHash: await bcrypt.hash(password, 10),
        managerUid: req.user.uid,
        members: [req.user.uid],
        mealOpen: false,
        createdAt: new Date(),
      });
    } catch (e) {
      if (e.code === 11000)
        return res.status(400).json({ message: "You are already in a room." });
      throw e;
    }
    res.json({ roomId });
  }),
);

r.post(
  "/rooms/join",
  w(async (req, res) => {
    const rm = await col("rooms").findOne({
      roomId: (req.body.roomId || "").trim().toUpperCase(),
    });
    if (
      !rm ||
      !(await bcrypt.compare(req.body.password || "", rm.passwordHash))
    )
      return res.status(400).json({ message: "Invalid Room ID or password" });
    const mine = await col("rooms").findOne(
      { members: req.user.uid },
      { projection: { roomId: 1 } },
    );
    if (mine) {
      return mine.roomId === rm.roomId
        ? res.json({ roomId: rm.roomId })
        : res.status(400).json({
            message:
              "You are already in a room. Leave it before joining another.",
          });
    }
    try {
      // one atomic step: only adds the member if there is still a free spot
      const result = await col("rooms").updateOne(
        {
          roomId: rm.roomId,
          $expr: {
            $lt: [
              { $size: "$members" },
              { $ifNull: ["$capacity", { $size: "$members" }] },
            ],
          },
        },
        { $addToSet: { members: req.user.uid } },
      );
      if (!result.matchedCount)
        return res.status(403).json({
          message:
            "This room is full. Ask the manager to increase the capacity.",
        });
    } catch (e) {
      if (e.code === 11000)
        return res.status(400).json({ message: "You are already in a room." });
      throw e;
    }
    res.json({ roomId: rm.roomId });
  }),
);
r.get(
  "/rooms",
  w(async (req, res) => {
    const rooms = await col("rooms")
      .find({ members: req.user.uid }, { projection: { passwordHash: 0 } })
      .toArray();
    res.json(
      rooms.map((x) => ({ ...x, isManager: x.managerUid === req.user.uid })),
    );
  }),
);

// ---------- room guard ----------
const room = w(async (req, res, next) => {
  const rm = await col("rooms").findOne({ roomId: req.params.id });
  if (!rm) return res.status(404).json({ message: "Room not found" });
  if (!rm.members.includes(req.user.uid))
    return res.status(403).json({ message: "You are not in this room" });
  req.room = rm;
  req.isManager = rm.managerUid === req.user.uid;
  next();
});
const manager = (req, res, next) =>
  req.isManager
    ? next()
    : res.status(403).json({ message: "Only the manager can do this" });
const memberList = async (rm) => {
  const users = await col("users")
    .find({ uid: { $in: rm.members } })
    .toArray();
  return rm.members
    .map((uid) => {
      const u = users.find((x) => x.uid === uid) || {};
      return {
        uid,
        name: u.name || "Member",
        email: u.email || "",
        isManager: uid === rm.managerUid,
      };
    })
    .sort((a, b) => b.isManager - a.isManager);
};

r.get(
  "/rooms/:id",
  room,
  w(async (req, res) => {
    const { passwordHash, ...rm } = req.room;
    const d = new Date();
    res.json({
      ...rm,
      capacity: rm.capacity ?? rm.members.length,
      listed: rm.listed !== false,
      members: await memberList(req.room),
      isManager: req.isManager,
      me: req.user.uid,
      month: month(),
      today: today(),
      monthLabel: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      daysInMonth: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
    });
  }),
);

// Manager: change capacity (can only go up to or above current members) and search visibility
r.patch(
  "/rooms/:id/settings",
  room,
  manager,
  w(async (req, res) => {
    const set = {};
    if (req.body.capacity !== undefined) {
      const c = Math.floor(Number(req.body.capacity));
      if (!(c >= req.room.members.length && c <= 100))
        return res.status(400).json({
          message: `Capacity must be between ${req.room.members.length} (current members) and 100`,
        });
      set.capacity = c;
    }
    if (req.body.listed !== undefined) set.listed = !!req.body.listed;
    if (!Object.keys(set).length)
      return res.status(400).json({ message: "Nothing to update" });
    await col("rooms").updateOne({ roomId: req.room.roomId }, { $set: set });
    res.json(set);
  }),
);

// Manager: hand the manager role to another member
r.patch(
  "/rooms/:id/manager",
  room,
  manager,
  w(async (req, res) => {
    const { uid } = req.body;
    if (!uid || uid === req.user.uid || !req.room.members.includes(uid))
      return res
        .status(400)
        .json({ message: "Pick another member of this room" });
    await col("rooms").updateOne(
      { roomId: req.room.roomId },
      { $set: { managerUid: uid } },
    );
    res.json({ managerUid: uid });
  }),
);

// Any member can leave. A manager has to promote someone else first.
r.post(
  "/rooms/:id/leave",
  room,
  w(async (req, res) => {
    if (req.isManager) {
      return res.status(400).json({
        message:
          req.room.members.length > 1
            ? "Promote another member to manager before leaving"
            : "You are the only member. Delete the room instead",
      });
    }
    await col("rooms").updateOne(
      { roomId: req.room.roomId },
      { $pull: { members: req.user.uid } },
    );
    res.json({ ok: true });
  }),
);

// Manager only: delete the room and everything inside it
r.delete(
  "/rooms/:id",
  room,
  manager,
  w(async (req, res) => {
    const roomId = req.room.roomId;
    await Promise.all(
      ["meals", "deposits", "demands", "expenses"].map((c) =>
        col(c).deleteMany({ roomId }),
      ),
    );
    await col("rooms").deleteOne({ roomId });
    res.json({ ok: true });
  }),
);

// ---------- meals ----------
r.patch(
  "/rooms/:id/meal-toggle",
  room,
  manager,
  w(async (req, res) => {
    await col("rooms").updateOne(
      { roomId: req.room.roomId },
      { $set: { mealOpen: !!req.body.open } },
    );
    res.json({ mealOpen: !!req.body.open });
  }),
);
r.get(
  "/rooms/:id/meals",
  room,
  w(async (req, res) => {
    res.json(
      await col("meals")
        .find({ roomId: req.room.roomId, month: month() })
        .toArray(),
    );
  }),
);
r.put(
  "/rooms/:id/meals",
  room,
  w(async (req, res) => {
    if (!req.room.mealOpen)
      return res
        .status(403)
        .json({ message: "Meal confirmation is turned off" });
    await col("meals").updateOne(
      { roomId: req.room.roomId, uid: req.user.uid, date: today() },
      {
        $set: {
          month: month(),
          lunch: num(req.body.lunch),
          dinner: num(req.body.dinner),
        },
      },
      { upsert: true },
    );
    res.json({ ok: true });
  }),
);

// ---------- deposits ----------
r.get(
  "/rooms/:id/deposits",
  room,
  w(async (req, res) => {
    const docs = await col("deposits")
      .find({ roomId: req.room.roomId, month: month() })
      .toArray();
    res.json(Object.fromEntries(docs.map((d) => [d.uid, d.amount])));
  }),
);
r.put(
  "/rooms/:id/deposits",
  room,
  manager,
  w(async (req, res) => {
    const ops = Object.entries(req.body.amounts || {})
      .filter(([uid]) => req.room.members.includes(uid))
      .map(([uid, a]) => ({
        updateOne: {
          filter: { roomId: req.room.roomId, month: month(), uid },
          update: { $set: { amount: num(a) } },
          upsert: true,
        },
      }));
    if (ops.length) await col("deposits").bulkWrite(ops);
    res.json({ ok: true });
  }),
);

// ---------- demands (custom table) ----------
r.get(
  "/rooms/:id/demands",
  room,
  w(async (req, res) => {
    const d = await col("demands").findOne({
      roomId: req.room.roomId,
      month: month(),
    });
    res.json({ fields: d?.fields || [], values: d?.values || {} });
  }),
);
r.put(
  "/rooms/:id/demands",
  room,
  manager,
  w(async (req, res) => {
    const { fields = [], values = {} } = req.body;
    await col("demands").updateOne(
      { roomId: req.room.roomId, month: month() },
      { $set: { fields, values } },
      { upsert: true },
    );
    res.json({ ok: true });
  }),
);

// ---------- expenses / spending ----------
const totals = async (roomId) => {
  const m = month();
  const [dep, meals, exp] = await Promise.all([
    col("deposits").find({ roomId, month: m }).toArray(),
    col("meals").find({ roomId, month: m }).toArray(),
    col("expenses").find({ roomId, month: m }).sort({ date: 1 }).toArray(),
  ]);
  return {
    dep,
    meals,
    exp,
    totalDeposit: dep.reduce((s, x) => s + x.amount, 0),
    totalMeal: meals.reduce((s, x) => s + x.lunch + x.dinner, 0),
    totalExpense: exp.reduce((s, x) => s + x.amount, 0),
  };
};
r.get(
  "/rooms/:id/spending",
  room,
  w(async (req, res) => {
    const t = await totals(req.room.roomId);
    res.json({
      totalDeposit: t.totalDeposit,
      totalExpense: t.totalExpense,
      balance: t.totalDeposit - t.totalExpense,
      expenses: t.exp,
    });
  }),
);
r.post(
  "/rooms/:id/expenses",
  room,
  manager,
  w(async (req, res) => {
    const { name, date, amount } = req.body;
    if (!name || !date || !(Number(amount) > 0))
      return res
        .status(400)
        .json({ message: "Name, date and amount are required" });
    await col("expenses").insertOne({
      roomId: req.room.roomId,
      month: month(),
      name,
      date,
      amount: Number(amount),
    });
    res.json({ ok: true });
  }),
);
r.delete(
  "/rooms/:id/expenses/:eid",
  room,
  manager,
  w(async (req, res) => {
    await col("expenses").deleteOne({
      _id: new ObjectId(req.params.eid),
      roomId: req.room.roomId,
    });
    res.json({ ok: true });
  }),
);

// ---------- summary ----------
r.get(
  "/rooms/:id/summary",
  room,
  w(async (req, res) => {
    const t = await totals(req.room.roomId);
    const rate = t.totalMeal ? t.totalDeposit / t.totalMeal : 0;
    const current = await memberList(req.room);
    const known = new Set(current.map((m) => m.uid));
    const extra = [
      ...new Set([...t.dep.map((x) => x.uid), ...t.meals.map((x) => x.uid)]),
    ].filter((u) => !known.has(u));
    const gone = extra.length
      ? await col("users")
          .find({ uid: { $in: extra } })
          .toArray()
      : [];
    const people = [
      ...current,
      ...extra.map((uid) => ({
        uid,
        name: gone.find((g) => g.uid === uid)?.name || "Former member",
        left: true,
      })),
    ];
    const rows = people.map((m) => {
      const meals = t.meals
        .filter((x) => x.uid === m.uid)
        .reduce((s, x) => s + x.lunch + x.dinner, 0);
      const deposit = t.dep.find((x) => x.uid === m.uid)?.amount || 0;
      const cost = meals * rate;
      return {
        uid: m.uid,
        name: m.name,
        left: !!m.left,
        meals,
        cost,
        deposit,
        balance: Math.round((deposit - cost) * 100) / 100,
      };
    });
    res.json({
      totalMeal: t.totalMeal,
      totalDeposit: t.totalDeposit,
      rate,
      rows,
    });
  }),
);

export default r;
