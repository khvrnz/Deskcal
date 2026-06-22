// ════════════════════════════════════════════════════════════════════════
//  TEMPLATE — copy this file to  src/firebase-config.js  and fill it in.
//  (src/firebase-config.js is gitignored so your API key never lands in git.)
//
//  Cross-device sync is optional. If you leave apiKey blank, the app still
//  works fully — it just stores notes locally (plus OneDrive/Drive folder sync
//  if you pick that in Settings).
// ════════════════════════════════════════════════════════════════════════
module.exports = {
  // Firebase Console → Project settings → General → "Web API Key" (AIzaSy...).
  // A Firebase Web API key is NOT a secret; security comes from the Realtime
  // Database rules. Still, keep this file out of public repos.
  apiKey: '',

  // Your Realtime Database URL, e.g. https://<project>-default-rtdb.<region>.firebasedatabase.app
  databaseURL: '',

  // Usually <project>.firebaseapp.com / <project> / your web App ID.
  authDomain: '',
  projectId: '',
  appId: '',

  // Social login is removed from the UI by default (email/password only),
  // so these can stay empty.
  oauth: {
    google: { clientId: '' },
    microsoft: { clientId: '', tenant: 'common' },
    github: { clientId: '', clientSecret: '' }
  }
};
