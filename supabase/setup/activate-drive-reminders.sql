-- Separate approval/activation step AFTER Pages deployment and iPhone tests.
-- This changes only notification configuration, never business records.
-- Preserve the original activation cutoff on subsequent runs. Never backdate it.
update public.drive_reminder_settings
set enabled=true, activated_at=coalesce(activated_at,now())
where singleton;
