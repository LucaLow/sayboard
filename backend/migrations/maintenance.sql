-- Optional deliberate cleanup with the restricted runtime role.
-- No cron, daemon, permissions or automatic execution are configured by this PR.
DELETE FROM sayboard.sessions
  WHERE expires_at <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
DELETE FROM sayboard.login_limits
  WHERE expires_at <= floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
