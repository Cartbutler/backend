require('dotenv').config();
const express = require('express');
const cors = require('cors'); // Import the cors package
const { PrismaClient } = require('@prisma/client');
const path = require('path');
const fs = require('fs');
const { Storage } = require('@google-cloud/storage');
const sharp = require('sharp'); // Add sharp for image processing
const app = express();
const port = process.env.PORT || 5000;
const host = process.env.HOST || 'localhost'; // Bind to localhost

app.use(express.json());
app.use(cors()); // Enable CORS for all routes

const prisma = new PrismaClient();

// Set up Google Cloud Storage
const storage = new Storage();
const bucket_name = process.env.GCLOUD_STORAGE_BUCKET; // Replace with your actual bucket name
const bucket = storage.bucket(bucket_name);

// Function to resize an image asynchronously
async function resize_image_async(image_url, image_name) {
    try {
        const fetch = (await import('node-fetch')).default; // Dynamically import node-fetch
        const response = await fetch(image_url);
        if (!response.ok) {
            throw new Error(`Failed to fetch image from URL: ${image_url}`);
        }
        const buffer = await response.buffer();

        const resized_buffer = await sharp(buffer)
            .resize(160, 160)
            .toBuffer();

        const resized_image_name = `160x160-${image_name}`;
        const resized_image_blob = bucket.file(resized_image_name);

        // Check if the resized image already exists
        const [exists] = await resized_image_blob.exists();
        if (!exists) {
            await resized_image_blob.save(resized_buffer);
        }
    } catch (err) {
        console.error('Image resizing error:', err.message);
    }
}

async function fetch_or_create_cart(user_id) {
    let cart = await prisma.cart.findFirst({
        where: { userId: user_id },
        include: {
            cartItems: {
                include: {
                    products: true
                }
            }
        }
    });

    if (!cart) {
        cart = await prisma.cart.create({
            data: {
                userId: user_id,
                cartItems: []
            },
            include: {
                cartItems: {
                    include: {
                        products: true
                    }
                }
            }
        });
    }

    return cart;
}

// Root route
app.get('/', (req, res) => {
    res.send('Welcome to the CartButler API this screen is just a landing page');
});

// Example endpoint to list all categories
app.get('/categories', async (req, res) => {
    try {
        const categories = await prisma.categories.findMany({
            select: {
                category_id: true,
                category_name: true,
                image_path: true, // Include image_path in the response
            }
        });

        console.log('Categories fetched:', categories); // Log the fetched categories

        if (categories.length === 0) {
            console.warn('No categories found in the database.');
        }

        res.json(categories);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Product suggestions endpoint with multi-word search support
app.get('/suggestions', async (req, res) => {
    try {
        const { query } = req.query; // Get query parameter

        if (!query) {
            return res.status(400).json({ error: 'Query parameter is required' });
        }

        const search_terms = query.split(/\s+/); // Format to split with whitespace

        const conditions = search_terms.map(term => ({
            name: {
                contains: term.toLowerCase()
            }
        }));

        const p_suggestions = await prisma.pSuggestions.findMany({
            where: {
                OR: conditions
            },
            orderBy: {
                priority: 'desc' // Sorting by priority
            },
            take: 5 // Limit results
        });

        res.json(p_suggestions);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Single product endpoint to get product details by ID or query
app.get('/product', async (req, res) => {
    try {
        const { id } = req.query; // Get id parameter

        if (!id) {
            return res.status(400).json({ error: 'id parameter is required' });
        }

        const product = await prisma.products.findUnique({
            where: {
                product_id: parseInt(id, 10)
            },
            include: {
                product_store: {
                    include: {
                        stores: true
                    }
                }
            }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Calculate min and max prices
        const prices = product.product_store.map(ps => ps.price);
        const min_price = Math.min(...prices);
        const max_price = Math.max(...prices);

        // Prepare response data
        const response_data = {
            product_id: product.product_id,
            product_name: product.product_name,
            description: product.description,
            price: product.price,
            stock: product.stock,
            category_id: product.category_id,
            image_path: product.image_path,
            created_at: product.created_at,
            category_name: product.category_name,
            stores: product.product_store.map(ps => ({
                store_id: ps.store_id,
                price: ps.price,
                stock: ps.stock,
                store_name: ps.stores.store_name,
                store_location: ps.stores.store_location
            })),
            min_price,
            max_price
        };

        res.json(response_data);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Search endpoint to search for products
app.get('/search', async (req, res) => {
    try {
        const { query, categoryID } = req.query; // Get query and categoryID parameters

        if (!query && !categoryID) {
            return res.status(400).json({ error: 'At least one of query or categoryID parameter is required' });
        }

        const search_conditions = [];

        if (query) {
            const search_terms = query.split(/\s+/); // Split query into search terms
            search_terms.forEach(term => {
                search_conditions.push({
                    product_name: {
                        contains: term.toLowerCase()
                    }
                });
            });
        }

        if (categoryID) {
            search_conditions.push({
                category_id: parseInt(categoryID, 10)
            });
        }

        const products = await prisma.products.findMany({
            where: {
                OR: search_conditions
            },
            select: {
                product_id: true,
                product_name: true,
                image_path: true,
                price: true,
            },
            orderBy: {
                created_at: 'desc' // Sorting by creation date
            }
        });

        // Fire-and-forget task to resize images asynchronously
        products.forEach(product => {
            const image_name = path.basename(product.image_path);
            resize_image_async(product.image_path, image_name);
        });

        res.json(products);
    } catch (err) {
        console.error('Database query error:', err.message);
        res.status(500).json({ error: 'Database query error', details: err.message });
    }
});

// Add to shopping cart endpoint (POST)
app.post('/cart', async (req, res) => {
    try {
        const { userId, productId, quantity } = req.body;

        if (!userId || !productId || quantity === undefined) {
            return res.status(400).json({ error: 'userId, productId, and quantity are required' });
        }

        // Check if the product exists
        const product = await prisma.products.findUnique({
            where: { product_id: productId }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Fetch or create the cart for the user
        let cart = await fetch_or_create_cart(userId);

        if (quantity === 0) {
            // Remove the product from the cart
            await prisma.cartItems.deleteMany({
                where: {
                    cartId: cart.id,
                    productId: productId
                }
            });
        } else {
            // Add or update the product in the user's cart
            await prisma.cartItems.upsert({
                where: {
                    cartId_productId: {
                        cartId: cart.id,
                        productId: productId
                    }
                },
                update: {
                    quantity: quantity // Set the quantity directly
                },
                create: {
                    cartId: cart.id,
                    productId: productId,
                    quantity: quantity
                }
            });
        }

        // Retrieve the updated cart with cart items
        cart = await fetch_or_create_cart(userId);

        console.log(`User ${userId} updated their cart with product ${productId} and quantity ${quantity}`);
        res.json(cart);
    } catch (err) {
        console.error('Error updating cart:', err.message);
        res.status(500).json({ error: 'Error updating cart', details: err.message });
    }
});

// Get shopping cart endpoint (GET)
app.get('/cart', async (req, res) => {
    try {
        const { userId } = req.query;

        if (!userId) {
            return res.status(400).json({ error: 'userId is required' });
        }

        // Fetch or create the user's cart with cart items
        const cart = await fetch_or_create_cart(userId);

        console.log(`User ${userId} retrieved their cart items`);
        res.json(cart);
    } catch (err) {
        console.error('Error retrieving cart items:', err.message);
        res.status(500).json({ error: 'Error retrieving cart items', details: err.message });
    }
});

// Shopping results endpoint (POST)
app.post('/shopping-results', async (req, res) => {
    try {
        const { products } = req.body; // Get products with quantities from request body

        if (!products || !Array.isArray(products) || products.length === 0) {
            return res.status(400).json({ error: 'products parameter is required and should be a non-empty array' });
        }

        const product_ids_array = products.map(p => p.productId);
        const quantities = products.reduce((acc, p) => {
            acc[p.productId] = p.quantity;
            return acc;
        }, {});

        // Fetch products and their prices from stores
        const product_store_data = await prisma.product_store.findMany({
            where: {
                product_id: {
                    in: product_ids_array
                }
            },
            include: {
                products: true,
                stores: true
            }
        });

        // Group products by store
        const store_products = product_store_data.reduce((acc, product) => {
            const store_id = product.store_id;
            if (!acc[store_id]) {
                acc[store_id] = {
                    store_id: product.stores.store_id,
                    store_name: product.stores.store_name,
                    store_location: product.stores.store_location,
                    products: [],
                    total: 0
                };
            }
            const quantity = quantities[product.product_id];
            acc[store_id].products.push({
                product_id: product.product_id,
                product_name: product.products.product_name,
                price: product.price,
                quantity: quantity
            });
            acc[store_id].total += product.price * quantity;
            return acc;
        }, {});

        // Convert the store_products object to an array and sort by total price
        const sorted_stores = Object.values(store_products).sort((a, b) => a.total - b.total);

        res.json(sorted_stores);
    } catch (err) {
        console.error('Error fetching shopping results:', err.message);
        res.status(500).json({ error: 'Error fetching shopping results', details: err.message });
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

app.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
});