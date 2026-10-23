SET LOCAL statement_timeout = '120s';
DELETE FROM cron.job_run_details WHERE runid IN (SELECT runid FROM cron.job_run_details WHERE start_time < now() - interval '7 days' ORDER BY runid LIMIT 50000);