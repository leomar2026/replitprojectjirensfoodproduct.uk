# Jiren's Food Product

**Premium Filipino Frozen Foods & Chili Garlic Oil — E-Commerce & Operations Platform**

A full-stack web application for managing online orders, inventory, POS sales, expenses, and website content for a Filipino frozen food business based in the UK.

---

## Features

### Customer-Facing (E-Commerce)
- Product catalogue with stock-aware availability
- Shopping cart with delivery / pickup selection
- Delivery date picker with configurable schedule, buffer days, blocked dates, and holiday dates
- Daily order limit with configurable cap and custom message
- Promotional pricing & discount codes
- Delivery fee calculation by weight (kg) or by pack/jar count
- Ice pack weight surcharge for cold-chain orders
- Order confirmation via WhatsApp / email contact links
- Responsive single-page app — works on mobile, tablet, desktop
- Homepage banner slider (up to 5 banners, multiple transition styles)
- What's New / promotions section

### Admin Panel
- **Orders** — View, verify, confirm, and cancel orders; print invoices and receipts
- **Products** — Full CRUD with images, SKU, stock levels, promo pricing
- **Inventory** — Stock movements (restock / adjustment / write-off) with audit trail
- **POS / Sales** — Cashier terminal for walk-in and pickup sales with receipt printing
- **Reports** — Sales summaries, daily/weekly/monthly breakdowns, expense reports
- **Expenses** — Log expenses by vendor, category, and approval status
- **Master Data** — Units of measure, categories, vendors, delivery fee rules, bank details, promotions
- **Website Editor** — Edit homepage content, logo, banners, social links, footer, settings
- **User Management** — Create/deactivate manager and cashier accounts

### Security & Operations
- Role-based access control: `admin` → `manager` → `cashier`
- bcrypt password hashing (cost factor 12)
- Server-side sessions stored in PostgreSQL
- Helmet security headers
- Rate limiting (500 req / 15 min globally; 10 login attempts / 15 min)
- All admin actions logged with user, role, IP, and timestamp
- Sensitive file paths blocked from public access

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js | >= 20.0.0 |
| PostgreSQL | >= 14 |
| npm | >= 9 |

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/your-username/jirens-food-product.git
cd jirens-food-product
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, SESSION_SECRET, and CORS_ORIGIN at minimum
```

### 4. Run database migrations

```bash
npm run migrate
```

### 5. Seed the admin user

```bash
npm run seed
```

Default credentials (change immediately after first login):

| Field | Value |
|-------|-------|
| Username | `admin` |
| Password | `Admin@1234` |

Optionally seed the default products:

```bash
npm run seed:products
```

### 6. Start the server

```bash
npm start
```

Visit `http://localhost:5000`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | No | Server port (default: `5000`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Long random string (min 32 chars) |
| `CORS_ORIGIN` | Yes (prod) | Allowed frontend origin, e.g. `https://yourdomain.com` |
| `PGHOST` | VPS only | PostgreSQL host |
| `PGPORT` | VPS only | PostgreSQL port (default: `5432`) |
| `PGDATABASE` | VPS only | Database name |
| `PGUSER` | VPS only | Database user |
| `PGPASSWORD` | VPS only | Database password |

Generate a secure `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Database Setup

Migrations are idempotent (safe to re-run). They use `CREATE TABLE IF NOT EXISTS` and `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` guards throughout.

Run all migrations:

```bash
npm run migrate
```

Migration files (applied in order):

| File | Description |
|------|-------------|
| `database/migrations.sql` | Core tables: users, sessions, products, orders, inventory |
| `database/migrations_phase4.sql` | Expenses, vendors, master data, promotions, settings |
| `database/migrations_ice_pack.sql` | Ice pack fee columns |
| `database/migrations_phase5.sql` | Security & audit log tables |
| `database/migrations_phase6.sql` | Delivery schedule, daily limits, What's New |

---

## Project Structure

```
├── public/               # Static frontend (single-page app + product images)
│   └── uploads/          # Customer-facing uploaded images
├── routes/               # Express route handlers (one file per domain)
│   ├── admin.js          # Order confirm / verify / cancel
│   ├── auth.js           # Login / logout / session
│   ├── expenses.js       # Expense management
│   ├── inventory.js      # Stock movements
│   ├── maintenance.js    # System health
│   ├── master.js         # Master data, banners, settings
│   ├── orders.js         # Customer order placement
│   ├── pos.js            # POS / sales transactions
│   ├── products.js       # Product CRUD
│   ├── promotions.js     # Discount codes / promotions
│   ├── reports.js        # Sales & expense reports
│   ├── users.js          # User management
│   └── vendors.js        # Vendor management
├── middleware/
│   ├── auth.js           # requireAuth, requireRole
│   └── upload.js         # multer file upload config
├── utils/                # Serial number generators, audit log helpers
├── database/             # SQL migration files
├── scripts/
│   ├── migrate.js        # Run all migrations in order
│   ├── seed-admin.js     # Create default admin user
│   ├── seed-products.js  # Seed default product catalogue
│   └── backup-db.sh      # pg_dump backup script
├── uploads/              # Server-side uploads (never publicly served)
│   └── proofs/           # Order payment proof uploads
├── db.js                 # PostgreSQL connection pool
├── server.js             # Express app entry point
├── ecosystem.config.js   # PM2 process manager config
├── nginx.conf.example    # Nginx reverse proxy template
└── .env.example          # Environment variable template
```

---

## User Roles

| Role | Level | Access |
|------|-------|--------|
| `admin` | 3 | Full access — all panels, user management, website editor |
| `manager` | 2 | Orders, products, inventory, POS, reports, expenses, master data |
| `cashier` | 1 | POS sales terminal, own sales history |

---

## Running Locally

```bash
# Development (with auto-restart on crash)
npm start

# Or with nodemon for hot reload (install separately)
npx nodemon server.js
```

The API is available at `http://localhost:5000/api/`

---

## Deployment

### Replit (Quick Deploy)

1. Fork or import the repository into Replit
2. Replit provisions the PostgreSQL database automatically — `DATABASE_URL` is set as a secret
3. Add `SESSION_SECRET` and `CORS_ORIGIN` as Replit Secrets
4. Run migrations via the Shell: `npm run migrate && npm run seed`
5. Click **Run** — the app starts on port 5000

---

### VPS Deployment (Ubuntu 20.04 / 22.04)

#### Prerequisites

- Ubuntu 20.04 or 22.04
- Node.js >= 20
- PostgreSQL 14+
- Nginx
- PM2
- Certbot (for HTTPS)

#### Step 1 — Server setup

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx certbot python3-certbot-nginx ufw

# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2
sudo npm install -g pm2
```

#### Step 2 — PostgreSQL setup

```bash
sudo apt install -y postgresql postgresql-contrib
sudo -u postgres psql -c "CREATE USER jirens_app WITH PASSWORD 'STRONG_PASSWORD_HERE';"
sudo -u postgres psql -c "CREATE DATABASE jirens_food OWNER jirens_app;"
```

#### Step 3 — Deploy the app

```bash
cd /var/www
sudo git clone https://github.com/your-username/jirens-food-product.git
sudo chown -R $USER:$USER /var/www/jirens-food-product
cd jirens-food-product

npm install --omit=dev

cp .env.example .env
nano .env   # Set NODE_ENV=production, DATABASE_URL, SESSION_SECRET, CORS_ORIGIN
```

#### Step 4 — Create directories

```bash
mkdir -p uploads/proofs
chmod 750 uploads/proofs

sudo mkdir -p /var/log/jirens
sudo chown $USER:$USER /var/log/jirens
```

#### Step 5 — Run migrations and seed

```bash
npm run migrate
npm run seed
```

#### Step 6 — Start with PM2

```bash
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup    # Run the command it outputs to enable autostart on reboot
```

Useful PM2 commands:

```bash
pm2 status                        # Check status
pm2 logs jirens-food-product      # Stream logs
pm2 restart jirens-food-product   # Restart
pm2 stop jirens-food-product      # Stop
```

---

### Nginx Setup

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/jirensfood
sudo nano /etc/nginx/sites-available/jirensfood   # Replace yourdomain.com
sudo ln -s /etc/nginx/sites-available/jirensfood /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

### SSL Setup (Certbot)

```bash
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Certbot automatically updates the Nginx config and configures auto-renewal.

Test renewal:

```bash
sudo certbot renew --dry-run
```

#### Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

---

### Automated Database Backups

```bash
chmod +x scripts/backup-db.sh
bash scripts/backup-db.sh   # Test manually first

# Add to cron — runs daily at 2 AM
(crontab -l 2>/dev/null; echo "0 2 * * * /var/www/jirens-food-product/scripts/backup-db.sh >> /var/log/jirens/backup.log 2>&1") | crontab -
```

Restore from backup:

```bash
gunzip -c /var/backups/jirens/jirens_backup_YYYYMMDD_HHMMSS.sql.gz | psql "$DATABASE_URL"
```

---

## Security Notes (Production Checklist)

- [ ] `NODE_ENV=production` is set — enables secure cookies, hides stack traces
- [ ] `SESSION_SECRET` is a long random string (min 32 chars, generated with `crypto.randomBytes`)
- [ ] `CORS_ORIGIN` matches your exact production domain
- [ ] `.env` is never committed — only `.env.example` is in version control
- [ ] Admin password is changed from the default after first login
- [ ] Firewall allows only SSH, HTTP (80), HTTPS (443)
- [ ] SSL certificate is installed and auto-renewal is configured
- [ ] Database user has minimal privileges (not `postgres` superuser)
- [ ] Database backups are running and tested

---

## License

Private / proprietary. All rights reserved — Jiren's Food Product.
