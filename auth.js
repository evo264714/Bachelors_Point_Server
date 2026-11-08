// import 'dotenv/config';
// const cache = new Map();
// // Asks Google to validate the Firebase ID token (needs only your web API key, no service account)
// export async function requireAuth(req, res, next) {
//   try {
//     const token = (req.headers.authorization || '').replace('Bearer ', '');
//     if (!token) return res.status(401).json({ message: 'Please login' });
//     const hit = cache.get(token);
//     if (hit && hit.exp > Date.now()) { req.user = hit.user; return next(); }
//     const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`, {
//       method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
//     });
//     const u = r.ok ? (await r.json()).users?.[0] : null;
//     if (!u) return res.status(401).json({ message: 'Please login again' });
//     const user = { uid: u.localId, email: u.email, name: u.displayName || u.email?.split('@')[0] };
//     cache.set(token, { user, exp: Date.now() + 60000 });
//     req.user = user; next();
//   } catch { res.status(401).json({ message: 'Auth failed' }); }
// }



import 'dotenv/config';
const cache = new Map();

async function verify(token) {
  if (!token) return null;
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${process.env.FIREBASE_API_KEY}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }),
  });
  const u = r.ok ? (await r.json()).users?.[0] : null;
  if (!u) return null;
  const user = { uid: u.localId, email: u.email, name: u.displayName || u.email?.split('@')[0] };
  cache.set(token, { user, exp: Date.now() + 60000 });
  return user;
}
const tok = (req) => (req.headers.authorization || '').replace('Bearer ', '');

export async function requireAuth(req, res, next) {
  try {
    const u = await verify(tok(req));
    if (!u) return res.status(401).json({ message: 'Please login again' });
    req.user = u; next();
  } catch { res.status(401).json({ message: 'Auth failed' }); }
}

// Lets logged-out visitors through (req.user stays null)
export async function optionalAuth(req, res, next) {
  try { req.user = await verify(tok(req)); } catch { req.user = null; }
  next();
}