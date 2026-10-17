# Teacher pilot

The pilot runs the complete app, authentication, dashboard and SQLite database on one VPS. The official free app is [sayboard.org](https://sayboard.org). Use [classroom.sayboard.org/teacher.html](https://classroom.sayboard.org/teacher.html) for the hosted pilot. Independent installations use their own hostname and `/teacher.html`.

## First classroom

1. Sign in with an operator-created adult account. There is no public signup, student email or student password.
2. Create a classroom, then add a profile using an alias such as `Learner A`. Begin with demonstration vocabulary.
3. Choose **Edit board**. The existing board editor supports tiles, categories, import and export. **Save classroom draft** stores the draft on the server.
4. Choose **Preview board** to try the actual communication view. Return to the dashboard and **Publish saved draft** when it is ready.
5. Enter a device name and create a pairing code. The code expires after 10 minutes and works once. Creating another code replaces the previous unused code for that profile.
6. On the intended device, open the same classroom hostname. Enter caregiver controls, choose **Edit board and settings**, expand **Backup and transfer**, and enter the pairing code under classroom connection.
7. Linking does not replace the local board. Choose **Load published board**, review the draft, then **Save board** to apply it.

Updates follow the same deliberate load and save steps. The board does not rearrange itself while someone is communicating. On a later visit, **Check classroom connection** restores the connection panel from the device's secure cookie.

## Recover or remove access

Select an older version in the dashboard to restore it into the draft, then preview and publish separately. Existing devices keep their current local board until a caregiver applies an update.

Revoke a device in the dashboard to stop future downloads. A device can also disconnect itself. Neither action erases its working local board. Device credentials expire after 30 days; pair again when needed. Clearing browser cookies also requires pairing again.

Deleting a profile or classroom removes its drafts, publications and device links from the live database. It does not erase exported files or boards already saved on devices. Encrypted backups retain deleted data until their retention period ends. Operator commands can reset passwords or delete an adult account and its associated data.

## Pilot limits

One adult owns each classroom. Multiple teachers sharing a school workspace, invitations, delegated roles, self-service password resets and billing are not implemented. Classroom hosting currently uses SQLite; the optional PostgreSQL adapter supports personal backups only.

Use an individual adult account rather than a shared password. Store only the vocabulary and aliases needed for the pilot. There is no analytics or collection of what a learner says. Classroom drafts and publications intentionally live on the server; local communication boards stay on their device unless explicitly saved or exported.

Export the working board before switching website addresses, browsers or devices. Boards created at `sayboard.vercel.app` do not automatically appear at `sayboard.org` or the classroom hostname. Offline startup and actual speech still need checking on the teacher's intended hardware. Keep the person's established communication tools available.

## Operator checks

Before using real classroom data, confirm the school's permission and data-handling arrangements, give the teacher their own account, and verify speech on the intended device. Test creation, publication, pairing, update, rollback and revocation with demonstration boards. Verify an encrypted backup can be decrypted and restored. Keep the recovery key and a recent encrypted copy off the VPS.

The automated suite executes the complete browser workflow in Chromium and WebKit, checks cross-account isolation and device scope against the actual SQLite API, and tests server restart and snapshot restore. See [SELF-HOSTING.md](SELF-HOSTING.md) for deployment and maintenance.
