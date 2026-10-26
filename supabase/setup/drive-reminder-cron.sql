-- Run only after reviewing/applying the additive migration, deploying the Edge
-- Function, and creating Vault secrets named drive_reminder_project_url and
-- drive_reminder_cron_secret. This script never writes business tables.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='drive_reminder_project_url')
 or not exists(select 1 from vault.decrypted_secrets where name='drive_reminder_cron_secret' and length(decrypted_secret)>=32)
 then raise exception 'Create the two Drive Reminders Vault secrets first'; end if;
end $$;

-- This schedule is the actual check-interval configuration. To change the
-- interval, update this expression and re-run cron.schedule with this same name.
select cron.schedule('teslatrack-drive-reminders', '*/5 * * * *', $job$
 select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name='drive_reminder_project_url') || '/functions/v1/drive-reminders',
  headers := jsonb_build_object('Content-Type','application/json','x-drive-reminder-secret',
    (select decrypted_secret from vault.decrypted_secrets where name='drive_reminder_cron_secret')),
  body := '{"action":"tick"}'::jsonb,
  timeout_milliseconds := 60000
 );
$job$);

-- Activate only AFTER both iPhones pass Send Test Notification and the Pages
-- update is live. This cutoff excludes every drive started before activation.
-- Uncomment and run once when ready (do not backdate activated_at):
-- update public.drive_reminder_settings
-- set enabled=true, activated_at=coalesce(activated_at,now()) where singleton;
