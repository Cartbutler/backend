require('dotenv').config();
const express = require('express');
const cors = require('cors');
const app = express();
const port = process.env.PORT || 5000;
const host = process.env.HOST || 'localhost';

// Import utility functions
const normalizeLanguage = require('./utils/normalizeLanguage');

// Apply normalized language to ALL routes in the app
app.use(normalizeLanguage);

app.use(express.json());
app.use(cors());

// Root route
app.get('/', (req, res) => {
    res.send('Welcome to the CartButler API. This screen is just a landing page.');
});

// Import and use endpoints
const categoriesRoutes = require('./endpoints/categories');
const productsRoutes = require('./endpoints/products');
const cartRoutes = require('./endpoints/cart');
const shoppingResultsRoutes = require('./endpoints/shopping_results');

app.use('/categories', categoriesRoutes);
app.use('/', productsRoutes);
app.use('/cart', cartRoutes);
app.use('/shopping-results', shoppingResultsRoutes);

app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

app.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});