// Desktop OAuth via a loopback redirect. Opens the provider's sign-in page in a
// BrowserWindow, runs a one-shot http://127.0.0.1:<port> server to catch the
// redirect with the auth code, then exchanges it (PKCE for Google/Microsoft;
// client_secret for GitHub). Returns the token set ({ id_token | access_token }).
const http = require('http');
const crypto = require('crypto');
const { BrowserWindow } = require('electron');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// Provider definitions; clientId/secret come from the baked firebase-config.
const PROVIDERS = {
  google: {
    providerId: 'google.com',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    credKey: 'id_token'
  },
  microsoft: {
    providerId: 'microsoft.com',
    authUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token',
    scope: 'openid email profile',
    credKey: 'id_token'
  },
  github: {
    providerId: 'github.com',
    authUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    credKey: 'access_token'
  }
};

// Run the interactive flow. `conf` is the per-provider entry from firebase-config.oauth.
async function login(name, conf) {
  const p = PROVIDERS[name];
  if (!p) throw new Error('Unknown provider: ' + name);
  if (!conf || !conf.clientId) throw new Error(`${name} sign-in isn't configured in this build.`);
  const tenant = conf.tenant || 'common';
  const authUrl = p.authUrl.replace('{tenant}', tenant);
  const tokenUrl = p.tokenUrl.replace('{tenant}', tenant);

  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    const server = http.createServer();
    let settled = false;
    const finish = (fn, arg) => { if (!settled) { settled = true; try { server.close(); } catch {} fn(arg); } };

    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      const redirectUri = `http://127.0.0.1:${port}`;
      const u = new URL(authUrl);
      u.searchParams.set('client_id', conf.clientId);
      u.searchParams.set('redirect_uri', redirectUri);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('scope', p.scope);
      u.searchParams.set('state', state);
      if (name !== 'github') {
        u.searchParams.set('code_challenge', challenge);
        u.searchParams.set('code_challenge_method', 'S256');
        u.searchParams.set('prompt', 'select_account');
      }

      const win = new BrowserWindow({
        width: 520, height: 700, autoHideMenuBar: true, title: 'Sign in',
        webPreferences: { nodeIntegration: false, contextIsolation: true }
      });
      win.loadURL(u.toString());
      win.on('closed', () => finish(reject, new Error('Sign-in cancelled')));

      server.on('request', async (req, res) => {
        const ru = new URL(req.url, redirectUri);
        const code = ru.searchParams.get('code');
        const st = ru.searchParams.get('state');
        const err = ru.searchParams.get('error');
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><meta charset="utf-8"><body style="font-family:Segoe UI,sans-serif;text-align:center;padding:40px;background:#1c1e22;color:#e8eaed"><h2>✓ Signed in</h2><p>You can close this window and return to Desktop Calendar.</p></body>');
        if (settled) return;
        try { if (!win.isDestroyed()) win.close(); } catch {}
        if (err) return finish(reject, new Error(err));
        if (!code || st !== state) return finish(reject, new Error('OAuth handshake failed'));
        try {
          const body = new URLSearchParams({
            client_id: conf.clientId, code, redirect_uri: redirectUri,
            grant_type: 'authorization_code', code_verifier: verifier
          });
          if (conf.clientSecret) body.set('client_secret', conf.clientSecret);
          const tr = await fetch(tokenUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            body: body.toString()
          });
          const tok = await tr.json();
          if (tok.error) return finish(reject, new Error(tok.error_description || tok.error));
          tok.providerId = p.providerId;
          tok.credKey = p.credKey;
          finish(resolve, tok);
        } catch (e) { finish(reject, e); }
      });
    });
    server.on('error', (e) => finish(reject, e));
  });
}

module.exports = { login };
