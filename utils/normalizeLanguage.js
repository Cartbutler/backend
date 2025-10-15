const normalizeLanguage = (req, res, next) => {
    if (req.query.language_id) {
        if (req.query.language_id.toLowerCase().startsWith('en')) {
            req.query.language_id = 'en-US';
        }
    } else {
        req.query.language_id = 'en-US';
    }
    next();
};

module.exports = normalizeLanguage;