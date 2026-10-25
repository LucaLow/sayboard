# Google teacher sign-in

Google sign-in is optional. The free communication app, existing teacher passwords and private invitations work without it. The Google route uses the existing eight-hour Sayboard session and the same classroom ownership checks. Learners do not need a Google account or email address.

## Operator setup

This step needs access to the Google Cloud project that will own the OAuth client. No Google project or production credentials are included in this repository.

1. In Google Cloud's Google Auth Platform, configure the app's branding, support contact, authorised domain `sayboard.org`, and audience. Choose the audience that includes your intended teachers. While an external app is in testing, add the intended pilot Google accounts as test users.
2. Create an OAuth client of type **Web application**. Register this exact authorised redirect URI for the current pilot:

   ```text
   https://classroom.sayboard.org/api/auth/google/callback
   ```

   Independent installations use `https://YOUR_HOSTNAME/api/auth/google/callback`. If the official service later moves to the main website, register `https://sayboard.org/api/auth/google/callback` before changing its configured origin. Changing hosts also affects existing sessions and device pairing; this feature does not migrate them.
3. Put the client credentials in the server's private `.env` file, readable only by the operator:

   ```text
   SAYBOARD_AUTH_ENABLED=1
   SAYBOARD_GOOGLE_CLIENT_ID=YOUR_CLIENT_ID.apps.googleusercontent.com
   SAYBOARD_GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
   SAYBOARD_GOOGLE_SIGNUP_ENABLED=1
   ```

   Keep `SAYBOARD_STORAGE=sqlite` and `SAYBOARD_ORIGIN` set to the exact HTTPS origin. Docker Compose already passes the Google settings to the app. For a direct service, configure the same server-only environment values. Never use `VITE_` for these settings or put the secret into a browser build, source archive, public issue or chat.
4. Recreate the app and proxy using the maintenance commands in [SELF-HOSTING.md](SELF-HOSTING.md). The teacher page now shows **Continue with Google**. No JavaScript origins are needed because this integration uses a server redirect flow rather than Google's browser SDK.
5. Sign in with an intended school Google account, create a demonstration classroom, sign out, and sign back in. Confirm the same classroom returns. Confirm an existing password account still works. Test the real school's managed account before inviting teachers widely.

`SAYBOARD_GOOGLE_SIGNUP_ENABLED=1` allows anyone who completes Google sign-in with a verified email to create an ordinary teacher account. It does not restrict signup to a school or grant organiser permission. Set it to `0` to stop new Google accounts while allowing existing Google teachers to sign in. Remove both client credentials to disable Google completely. Partial or unsupported configuration stops server startup rather than silently disabling authentication. Google classroom accounts require SQLite; the optional PostgreSQL adapter remains for personal backups.

## Accounts and privacy

Google is used only to prove who the adult is. The requested scopes are `openid email`; no Drive, Calendar, Classroom or Gmail access is requested. The app discards provider access tokens and does not request refresh tokens. It stores Google's stable subject identifier against a Sayboard account, not the teacher's email address. The email-verification claim is checked but the email is not retained.

Returning Google sign-in finds the account by subject. It never links an existing password account by matching an email or username. A teacher who already has a password account should keep using it to access its existing classrooms. Automatic account merging and linking are outside this change. An organiser can still assist an account through the existing account-maintenance tools; new Google accounts do not receive invitation privileges.

Google-only accounts have no usable password. They receive an internal teacher username for the existing account API but do not need to choose or type it. Deleting an account also deletes its Google identity. As with all account deletions, copies already exported or saved on devices are unaffected.

## Verification and failure behaviour

The server uses an authorization-code flow with PKCE, a browser-bound state cookie, a one-use SQLite attempt and a nonce. The short-lived state cookie is HttpOnly, Secure and SameSite=Lax so it can return from Google. The normal Sayboard session remains HttpOnly, Secure and SameSite=Strict. ID-token signature, issuer, audience, presenter, issuance, expiry, nonce and verified-email claims are checked before provisioning a teacher or session.

The callback always returns to `/teacher`; clients cannot provide an arbitrary return URL. Cancellation, provider failure and expired login attempts return a recoverable teacher message, with password login still available. Google secrets, codes and tokens are not put in logs or localStorage. Existing working communication boards are not uploaded or replaced by signing in.

Run the synthetic integration tests with `npm run --prefix backend test -- --run tests/google.test.ts` and the built-server browser check with `node tests/google-signin.browser.mjs`. The browser check runs the actual emitted app, HTTPS proxy, SQLite database and a local Google provider fixture. It checks cookie handling, account creation and return visits without requiring a Google Cloud project. Passing these checks does not prove real Google Cloud configuration, school policy or consent-screen acceptance; step 5 is still required before production use.

Implementation references: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) and [Sign in with Google branding](https://developers.google.com/identity/branding-guidelines).
