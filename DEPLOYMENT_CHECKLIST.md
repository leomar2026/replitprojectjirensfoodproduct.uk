# Deployment Checklist

- [ ] Restore the full Node.js project source, including `package.json` and backend entrypoint.
- [ ] Confirm production branch and commit are correct.
- [ ] Confirm `.env` exists on the server and is not committed.
- [ ] Install Node.js 20 LTS.
- [ ] Install MySQL 8.x.
- [ ] Create production database and database user.
- [ ] Apply migrations or `database-schema.sql`.
- [ ] Install dependencies using the real project package manager.
- [ ] Run the real project build command only after confirming it exists.
- [ ] Configure PM2 with the real app entrypoint.
- [ ] Configure Nginx reverse proxy.
- [ ] Issue SSL certificate with Certbot.
- [ ] Configure UFW firewall.
- [ ] Confirm uploads directory exists and is writable by the app user.
- [ ] Verify Admin, Manager, Cashier, and Customer workflows.
- [ ] Verify checkout, POS, inventory, expenses, reports, and exports.
- [ ] Confirm database backups are scheduled.

