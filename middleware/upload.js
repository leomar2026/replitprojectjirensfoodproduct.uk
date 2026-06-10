const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'proofs');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'application/pdf': '.pdf'
};

const MAX_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = ALLOWED_TYPES[file.mimetype] || path.extname(file.originalname).toLowerCase();
        const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
        cb(null, unique);
    }
});

function fileFilter(req, file, cb) {
    if (!ALLOWED_TYPES[file.mimetype]) {
        return cb(new Error('Invalid file type. Allowed: jpg, jpeg, png, webp, pdf.'));
    }
    cb(null, true);
}

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: MAX_SIZE_BYTES }
});

module.exports = { upload, UPLOAD_DIR };
