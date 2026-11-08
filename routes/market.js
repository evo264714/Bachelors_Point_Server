import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { db } from '../db.js';
import { requireAuth, optionalAuth } from '../auth.js';

const r = Router();
const col = (n) => db().collection(n);
const w = (fn) => (req, res, next) => fn(req, res, next).catch((e) => { console.error(e); res.status(500).json({ message: 'Server error' }); });
const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const nameOf = async (user) => (await col('users').findOne({ uid: user.uid }))?.name || user.name;
const shape = (p, uid) => {
  const { hearts = [], ...rest } = p;
  return { ...rest, hearts: hearts.length, hearted: !!uid && hearts.includes(uid) };
};
const ownPost = async (req, res) => {
  const _id = oid(req.params.id);
  const p = _id && (await col('posts').findOne({ _id }, { projection: { authorUid: 1, status: 1 } }));
  if (!p) { res.status(404).json({ message: 'Post not found' }); return null; }
  if (p.authorUid !== req.user.uid) { res.status(403).json({ message: 'This is not your post' }); return null; }
  return p;
};

// ================= PUBLIC: anyone can view =================
r.get('/market/posts', optionalAuth, w(async (req, res) => {
  const { type, category, q, skip = 0 } = req.query;
  const f = {};
  if (['sell', 'buy'].includes(type)) f.type = type;
  if (category) f.category = category;
  if (q) f.$or = [{ title: { $regex: esc(q), $options: 'i' } }, { description: { $regex: esc(q), $options: 'i' } }];
  const posts = await col('posts')
    .find(f, { projection: { images: { $slice: 1 } } }) // list only needs the first photo
    .sort({ createdAt: -1 }).skip(Number(skip) || 0).limit(40).toArray();
  res.json(posts.map((p) => shape(p, req.user?.uid)));
}));

r.get('/market/posts/:id', optionalAuth, w(async (req, res) => {
  const _id = oid(req.params.id);
  const p = _id && (await col('posts').findOne({ _id }));
  if (!p) return res.status(404).json({ message: 'Post not found' });
  res.json(shape(p, req.user?.uid));
}));

r.get('/market/posts/:id/comments', w(async (req, res) => {
  const _id = oid(req.params.id);
  if (!_id) return res.json([]);
  res.json(await col('comments').find({ postId: _id }).sort({ createdAt: 1 }).limit(200).toArray());
}));

// ================= LOGGED-IN: posts, hearts, comments =================
r.post('/market/posts', requireAuth, w(async (req, res) => {
  const { type, title, description = '', price, category, condition, images = [] } = req.body;
  if (!['sell', 'buy'].includes(type) || !title?.trim()) return res.status(400).json({ message: 'Type and title are required' });
  if (!Array.isArray(images) || images.length > 3 ||
      images.some((i) => typeof i !== 'string' || !i.startsWith('data:image/') || i.length > 1500000))
    return res.status(400).json({ message: 'Up to 3 small photos only' });
  const { insertedId } = await col('posts').insertOne({
    type, title: title.trim().slice(0, 100), description: String(description).slice(0, 1000),
    price: Math.max(0, Number(price) || 0), category: category || 'Other', condition: condition === 'new' ? 'new' : 'used',
    images, imageCount: images.length, authorUid: req.user.uid, authorName: await nameOf(req.user),
    status: 'available', hearts: [], commentCount: 0, createdAt: new Date(),
  });
  res.json({ _id: insertedId });
}));

r.delete('/market/posts/:id', requireAuth, w(async (req, res) => {
  const p = await ownPost(req, res); if (!p) return;
  await col('posts').deleteOne({ _id: p._id });
  await col('comments').deleteMany({ postId: p._id });
  res.json({ ok: true });
}));

r.patch('/market/posts/:id/sold', requireAuth, w(async (req, res) => {
  const p = await ownPost(req, res); if (!p) return;
  const status = p.status === 'sold' ? 'available' : 'sold';
  await col('posts').updateOne({ _id: p._id }, { $set: { status } });
  res.json({ status });
}));

r.post('/market/posts/:id/heart', requireAuth, w(async (req, res) => {
  const _id = oid(req.params.id);
  const p = _id && (await col('posts').findOne({ _id }, { projection: { hearts: 1 } }));
  if (!p) return res.status(404).json({ message: 'Post not found' });
  const has = (p.hearts || []).includes(req.user.uid);
  await col('posts').updateOne({ _id }, { [has ? '$pull' : '$addToSet']: { hearts: req.user.uid } });
  res.json({ hearted: !has, count: (p.hearts || []).length + (has ? -1 : 1) });
}));

r.post('/market/posts/:id/comments', requireAuth, w(async (req, res) => {
  const postId = oid(req.params.id);
  const text = String(req.body.text || '').trim().slice(0, 500);
  if (!postId || !text) return res.status(400).json({ message: 'Write a comment first' });
  if (!(await col('posts').findOne({ _id: postId }, { projection: { _id: 1 } }))) return res.status(404).json({ message: 'Post not found' });
  const doc = { postId, uid: req.user.uid, name: await nameOf(req.user), text, createdAt: new Date() };
  const { insertedId } = await col('comments').insertOne(doc);
  await col('posts').updateOne({ _id: postId }, { $inc: { commentCount: 1 } });
  res.json({ ...doc, _id: insertedId });
}));

r.delete('/market/comments/:cid', requireAuth, w(async (req, res) => {
  const _id = oid(req.params.cid);
  const c = _id && (await col('comments').findOne({ _id }));
  if (!c) return res.status(404).json({ message: 'Comment not found' });
  const p = await col('posts').findOne({ _id: c.postId }, { projection: { authorUid: 1 } });
  if (c.uid !== req.user.uid && p?.authorUid !== req.user.uid) return res.status(403).json({ message: 'Not allowed' });
  await col('comments').deleteOne({ _id });
  await col('posts').updateOne({ _id: c.postId }, { $inc: { commentCount: -1 } });
  res.json({ ok: true });
}));

// ================= PROFILE + DM switch =================
r.get('/me', requireAuth, w(async (req, res) => {
  const u = await col('users').findOne({ uid: req.user.uid });
  res.json({ uid: req.user.uid, name: u?.name || req.user.name, email: req.user.email, dmOn: u?.dmOn !== false });
}));
r.patch('/me/dm', requireAuth, w(async (req, res) => {
  await col('users').updateOne({ uid: req.user.uid }, { $set: { dmOn: !!req.body.dmOn } }, { upsert: true });
  res.json({ dmOn: !!req.body.dmOn });
}));

// ================= INBOX / DMs =================
const keyOf = (a, b) => [a, b].sort().join('_');

r.post('/inbox/send', requireAuth, w(async (req, res) => {
  const { toUid, text, postId } = req.body;
  const me = req.user.uid;
  const body = String(text || '').trim().slice(0, 1000);
  if (!toUid || toUid === me || !body) return res.status(400).json({ message: 'Write a message to someone else' });
  const to = await col('users').findOne({ uid: toUid });
  if (!to) return res.status(404).json({ message: 'User not found' });
  if (to.dmOn === false) return res.status(403).json({ message: 'This user has turned their DMs off' });
  let post = null;
  const pid = postId && oid(postId);
  if (pid) {
    const p = await col('posts').findOne({ _id: pid }, { projection: { title: 1 } });
    if (p) post = { id: String(pid), title: p.title };
  }
  const key = keyOf(me, toUid), now = new Date();
  await col('messages').insertOne({ key, from: me, text: body, post, createdAt: now });
  await col('conversations').updateOne({ key }, {
    $set: {
      members: [{ uid: me, name: await nameOf(req.user) }, { uid: toUid, name: to.name || 'Member' }],
      lastMessage: body.slice(0, 80), lastFrom: me, lastAt: now, [`unread.${me}`]: 0,
    },
    $inc: { [`unread.${toUid}`]: 1 },
  }, { upsert: true });
  res.json({ ok: true });
}));

r.get('/inbox', requireAuth, w(async (req, res) => {
  const me = req.user.uid;
  const cs = await col('conversations').find({ 'members.uid': me }).sort({ lastAt: -1 }).limit(50).toArray();
  res.json(cs.map((c) => ({
    key: c.key, other: c.members.find((m) => m.uid !== me), lastMessage: c.lastMessage,
    lastFrom: c.lastFrom, lastAt: c.lastAt, unread: c.unread?.[me] || 0,
  })));
}));

r.get('/inbox/unread-count', requireAuth, w(async (req, res) => {
  const me = req.user.uid;
  const cs = await col('conversations').find({ 'members.uid': me }).project({ unread: 1 }).toArray();
  res.json({ count: cs.reduce((s, c) => s + (c.unread?.[me] || 0), 0) });
}));

r.get('/inbox/:otherUid', requireAuth, w(async (req, res) => {
  const me = req.user.uid;
  const other = await col('users').findOne({ uid: req.params.otherUid });
  if (!other) return res.status(404).json({ message: 'User not found' });
  const key = keyOf(me, other.uid);
  const messages = await col('messages').find({ key }).sort({ createdAt: -1 }).limit(100).toArray();
  await col('conversations').updateOne({ key }, { $set: { [`unread.${me}`]: 0 } });
  res.json({ other: { uid: other.uid, name: other.name || 'Member', dmOn: other.dmOn !== false }, messages: messages.reverse() });
}));

export default r;