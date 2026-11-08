import { Router } from 'express';
import { db } from '../db.js';
import { optionalAuth } from '../auth.js';

const r = Router();
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Public: anyone can search. The phone number is only sent to logged-in users.
r.get('/search/rooms', optionalAuth, async (req, res) => {
  try {
    const tokens = String(req.query.q || '').trim().split(/\s+/).filter(Boolean).slice(0, 5);
    const f = { listed: { $ne: false }, capacity: { $gt: 0 } };
    if (tokens.length) {
      f.$and = tokens.map((t) => ({ $or: [{ address: { $regex: esc(t), $options: 'i' } }, { name: { $regex: esc(t), $options: 'i' } }] }));
    }
    if (req.query.vacancy !== '0') f.$expr = { $lt: [{ $size: '$members' }, '$capacity'] };

    const rooms = await db().collection('rooms').find(f, { projection: { passwordHash: 0 } }).sort({ createdAt: -1 }).limit(60).toArray();
    const mgrs = await db().collection('users').find({ uid: { $in: rooms.map((x) => x.managerUid) } }).toArray();

    res.json(rooms.map((x) => ({
      roomId: x.roomId, name: x.name, address: x.address, mealPerDay: x.mealPerDay,
      members: x.members.length, capacity: x.capacity, spotsLeft: Math.max(0, x.capacity - x.members.length),
      full: x.members.length >= x.capacity,
      managerUid: x.managerUid, managerName: mgrs.find((m) => m.uid === x.managerUid)?.name || 'Manager',
      phone: req.user ? x.phone : null,
      joined: !!req.user && x.members.includes(req.user.uid),
      createdAt: x.createdAt,
    })));
  } catch (e) { console.error(e); res.status(500).json({ message: 'Server error' }); }
});

export default r;