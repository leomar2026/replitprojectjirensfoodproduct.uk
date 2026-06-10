/**
 * Shared database helpers for number series and audit logging.
 */

/**
 * Atomically increment and return the next number for a document type.
 * @param {import('pg').PoolClient} client
 * @param {string} documentType  e.g. 'POS', 'RECEIPT', 'INVOICE'
 * @returns {Promise<string>}  e.g. 'POS-000001'
 */
async function nextSerialNumber(client, documentType) {
    const result = await client.query(`
        UPDATE number_series
        SET next_number = next_number + 1,
            updated_at  = NOW()
        WHERE document_type = $1
          AND is_active = TRUE
        RETURNING prefix, next_number - 1 AS current_number, padding
    `, [documentType]);

    if (!result.rows.length) {
        throw new Error(`Unknown or inactive document type: ${documentType}`);
    }

    const { prefix, current_number, padding } = result.rows[0];
    return `${prefix}-${String(current_number).padStart(padding, '0')}`;
}

/**
 * Insert an audit log entry inside a transaction.
 * @param {import('pg').PoolClient} client
 * @param {string} action
 * @param {string} entityType
 * @param {string} entityId
 * @param {string} userName
 * @param {object} details
 * @param {{ userId?: number, userRole?: string, ipAddress?: string }} [meta]
 */
async function addAuditLog(client, action, entityType, entityId, userName, details, meta = {}) {
    await client.query(`
        INSERT INTO audit_logs
            (action, entity_type, entity_id, user_name, details, user_id, user_role, ip_address)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [
        action,
        entityType || null,
        String(entityId || ''),
        userName || 'System',
        JSON.stringify(details || {}),
        meta.userId    || null,
        meta.userRole  || null,
        meta.ipAddress || null
    ]);
}

/**
 * Record one inventory movement and update product stock (must be inside a transaction).
 * Throws { statusCode, message } for business-rule violations (e.g. negative stock).
 */
async function recordInventoryMovement(client, {
    productId,
    movementType,
    quantity,
    notes,
    referenceType,
    referenceNumber,
    warehouse,
    createdBy
}) {
    // Lock the product row to avoid races
    const productResult = await client.query(
        'SELECT id, name, sku, stock_quantity FROM products WHERE id = $1 FOR UPDATE',
        [productId]
    );
    if (!productResult.rows.length) {
        const err = new Error('Product not found.');
        err.statusCode = 404;
        throw err;
    }
    const product = productResult.rows[0];

    const deductionTypes = ['Stock Out', 'Negative Adjustment', 'Damage', 'Expired', 'Sales Deduction'];
    const isDeduction = deductionTypes.includes(movementType);
    const quantityBefore = Number(product.stock_quantity);
    const quantityAfter = isDeduction ? quantityBefore - quantity : quantityBefore + quantity;

    if (quantityAfter < 0) {
        const err = new Error(`Insufficient stock for ${product.name}. Available: ${quantityBefore}.`);
        err.statusCode = 400;
        throw err;
    }

    await client.query(
        'UPDATE products SET stock_quantity = $1, updated_at = NOW() WHERE id = $2',
        [quantityAfter, productId]
    );

    const movResult = await client.query(`
        INSERT INTO inventory_movements
            (product_id, product_name, product_sku, movement_type,
             quantity, quantity_before, quantity_after,
             reference_type, reference_number, notes, warehouse, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
    `, [
        productId, product.name, product.sku,
        movementType, quantity, quantityBefore, quantityAfter,
        referenceType || 'Manual', referenceNumber || null,
        notes || null, warehouse || null, createdBy || 'System'
    ]);

    return { movement: movResult.rows[0], product, quantityBefore, quantityAfter };
}

module.exports = { nextSerialNumber, addAuditLog, recordInventoryMovement };
