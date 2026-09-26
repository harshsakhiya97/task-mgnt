-- Day-end WhatsApp report now at 21:15 IST (15:45 UTC), every day.
select cron.unschedule('whatsapp-daily-report');
select cron.schedule('whatsapp-daily-report', '45 15 * * *', $$select private.wa_daily_report()$$);
