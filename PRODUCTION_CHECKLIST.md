# Production Checklist

- [ ] `NODE_ENV=production`.
- [ ] Strong `JWT_SECRET` and `SESSION_SECRET`.
- [ ] No `.env` committed to Git.
- [ ] MySQL not exposed publicly.
- [ ] HTTPS enabled.
- [ ] Backend permission checks enforce Admin, Manager, Cashier, and Customer rules.
- [ ] Passwords are hashed.
- [ ] Upload file type and size validation enabled.
- [ ] Audit logs enabled for approvals, pricing, inventory, payment verification, and settings changes.
- [ ] Server-side checkout total validation enabled.
- [ ] Inventory deduction is transactional.
- [ ] Reports use server-side filters and pagination for large datasets.
- [ ] Error logs monitored through PM2.
- [ ] Backups tested with a restore rehearsal.

