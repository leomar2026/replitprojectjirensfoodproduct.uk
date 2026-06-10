require('dotenv').config();
const { pool } = require('../db');

const PRODUCTS = [
    { name: 'Cheese Hotdog',        sku: 'FP-CHD-500', category: 'Frozen Products', pack_display: '500g pack', uom: 'pack', price: 28, description: 'Juicy Filipino-style hotdogs with a creamy cheese center.',          image_filename: 'cheese-hotdog.png',          weight_kg: 0.5, cost_price: 18, stock_quantity: 24, reorder_level: 6 },
    { name: 'Classic Hotdog',       sku: 'FP-CLH-500', category: 'Frozen Products', pack_display: '500g pack', uom: 'pack', price: 24, description: 'Classic red Filipino hotdogs made for breakfast plates and snacks.',  image_filename: 'classic-hotdog.png',         weight_kg: 0.5, cost_price: 15, stock_quantity: 24, reorder_level: 6 },
    { name: 'Pork Tocino',          sku: 'FP-PTO-500', category: 'Frozen Products', pack_display: '500g pack', uom: 'pack', price: 32, description: 'Sweet and savory cured pork tocino, ready for pan-frying.',           image_filename: 'pork-tocino.png',            weight_kg: 0.5, cost_price: 21, stock_quantity: 18, reorder_level: 5 },
    { name: 'Chicken Tocino',       sku: 'FP-CTO-500', category: 'Frozen Products', pack_display: '500g pack', uom: 'pack', price: 30, description: 'Tender chicken tocino with a balanced sweet garlic marinade.',        image_filename: 'chicken-tocino.png',         weight_kg: 0.5, cost_price: 19, stock_quantity: 18, reorder_level: 5 },
    { name: 'Sweet Garlic Longanisa', sku: 'FP-SGL-500', category: 'Frozen Products', pack_display: '500g pack', uom: 'pack', price: 34, description: 'Sweet Filipino longanisa with fragrant garlic notes.',              image_filename: 'sweet-garlic-longanisa.png', weight_kg: 0.5, cost_price: 22, stock_quantity: 16, reorder_level: 5 },
    { name: 'Garlic Longanisa',     sku: 'FP-GLO-500', category: 'Frozen Products', pack_display: '500g pack', uom: 'pack', price: 34, description: 'Garlic-forward longanisa for classic Filipino breakfasts.',            image_filename: 'garlic-longanisa.png',       weight_kg: 0.5, cost_price: 22, stock_quantity: 16, reorder_level: 5 },
    { name: 'Beef Tapa',            sku: 'FP-BTA-500', category: 'Frozen Products', pack_display: '500g pack', uom: 'pack', price: 38, description: 'Marinated beef tapa with a savory-sweet finish.',                     image_filename: 'beef-tapa.png',              weight_kg: 0.5, cost_price: 25, stock_quantity: 14, reorder_level: 4 },
    { name: 'Chili Garlic Oil',     sku: 'CO-CGO-250', category: 'Condiments',      pack_display: '250ml jar', uom: 'jar',  price: 22, description: 'Small-batch chili garlic oil with crisp garlic and deep heat.',       image_filename: 'chili-garlic-oil.png',       weight_kg: 0.25, cost_price: 12, stock_quantity: 30, reorder_level: 8 },
];

async function seedProducts() {
    console.log('Seeding products...');
    let created = 0;
    let skipped = 0;

    for (const p of PRODUCTS) {
        const existing = await pool.query('SELECT id FROM products WHERE sku = $1', [p.sku]);
        if (existing.rows.length) {
            console.log(`  Skipping existing: ${p.name} (${p.sku})`);
            skipped++;
            continue;
        }
        await pool.query(`
            INSERT INTO products (name, sku, category, pack_display, uom, price, cost_price,
                description, image_filename, weight_kg, stock_quantity, reorder_level)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        `, [p.name, p.sku, p.category, p.pack_display, p.uom, p.price, p.cost_price,
            p.description, p.image_filename, p.weight_kg, p.stock_quantity, p.reorder_level]);
        console.log(`  Created: ${p.name}`);
        created++;
    }

    console.log(`Done. Created: ${created}, Skipped: ${skipped}`);
    await pool.end();
}

seedProducts().catch(err => {
    console.error('Seed products failed:', err.message);
    process.exit(1);
});
