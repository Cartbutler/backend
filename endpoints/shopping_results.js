const express = require('express');
const router = express.Router();
const calculateDistances = require('../utils/calculate_distances');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Shopping results endpoint
router.get('/', async (req, res) => {
    try {
        const { cart_id, user_id, radius, user_location } = req.query;

        if (!cart_id || !user_id) {
            return res.status(400).json({ error: 'cart_id and user_id parameters are required' });
        }

        const parsed_cart_id = parseInt(cart_id, 10);
        if (isNaN(parsed_cart_id)) {
            return res.status(400).json({ error: 'Invalid cart_id parameter' });
        }

        // Parse latitude and longitude if provided
        let user_lat = null;
        let user_lon = null;
        if (user_location) {
            [user_lat, user_lon] = user_location.split(',').map(Number);
            if (isNaN(user_lat) || isNaN(user_lon)) {
                return res.status(400).json({ error: 'Invalid user_location parameter' });
            }
        }

        // Fetch the cart with cart items for the user
        const cart = await prisma.cart.findFirst({
            where: { id: parsed_cart_id, user_id },
            include: {
                cart_items: {
                    include: {
                        products: {
                            include: {
                                product_store: {
                                    include: {
                                        stores: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        });

        if (!cart) {
            return res.status(404).json({ error: 'Cart not found or does not belong to the user' });
        }

        // Aggregate store products
        const store_products = cart.cart_items.reduce((acc, cartItem) => {
            cartItem.products.product_store.forEach(productStore => {
                const store_id = productStore.store_id;
                if (!acc[store_id]) {
                    acc[store_id] = {
                        store_id: productStore.stores.store_id,
                        store_name: productStore.stores.store_name,
                        store_location: productStore.stores.store_location,
                        store_address: productStore.stores.store_address,
                        store_image: productStore.stores.store_image,
                        latitude: productStore.stores.latitude,
                        longitude: productStore.stores.longitude,
                        products: [],
                        total: 0,
                    };
                }
                acc[store_id].products.push({
                    product_id: cartItem.product_id,
                    price: productStore.price,
                    quantity: cartItem.quantity,
                });
                acc[store_id].total += productStore.price * cartItem.quantity;
            });
            return acc;
        }, {});

        // If user_location is provided, calculate distances
        if (user_lat !== null && user_lon !== null) {
            const distances = await calculateDistances(user_lat, user_lon, Object.values(store_products));
            distances.forEach(({ store_id, distance }) => {
                if (store_products[store_id]) {
                    store_products[store_id].distance = parseFloat(distance.toFixed(3));
                }
            });

            // Filter stores by radius if provided
            if (radius) {
                const parsed_radius = parseFloat(radius);
                if (isNaN(parsed_radius)) {
                    return res.status(400).json({ error: 'Invalid radius parameter' });
                }
                Object.values(store_products).forEach(store => {
                    if (store.distance > parsed_radius) {
                        delete store_products[store.store_id];
                    }
                });
            }
        }

        // Return all stores if user_location is not provided
        const result = Object.values(store_products).map(store => ({
            store_id: store.store_id,
            store_name: store.store_name,
            store_location: store.store_location,
            store_address: store.store_address,
            store_image: store.store_image,
            latitude: store.latitude,
            longitude: store.longitude,
            distance: store.distance || null,
            total: store.total,
            products: store.products,
        }));

        res.json(result);
    } catch (err) {
        console.error('Error fetching shopping results:', err.message);
        res.status(500).json({ error: 'Error fetching shopping results', details: err.message });
    }
});

module.exports = router;