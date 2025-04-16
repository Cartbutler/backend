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

        const [user_lat, user_lon] = user_location.split(',').map(Number);

        const cart = await prisma.cart.findFirst({
            where: { id: parsed_cart_id, user_id },
            include: {
                cart_items: {
                    include: {
                        products: {
                            include: {
                                product_store: {
                                    include: { stores: true },
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

        const store_products = cart.cart_items.reduce((acc, cartItem) => {
            cartItem.products.product_store.forEach(productStore => {
                const store_id = productStore.store_id;
                if (!acc[store_id]) {
                    acc[store_id] = {
                        store_id: productStore.stores.store_id,
                        store_name: productStore.stores.store_name,
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

        const distances = await calculateDistances(user_lat, user_lon, Object.values(store_products));
        distances.forEach(({ store_id, distance }) => {
            if (store_products[store_id]) {
                store_products[store_id].distance = parseFloat(distance.toFixed(3));
            }
        });

        const filteredStores = Object.values(store_products).filter(store => store.distance <= radius);
        res.json(filteredStores);
    } catch (err) {
        console.error('Error fetching shopping results:', err.message);
        res.status(500).json({ error: 'Error fetching shopping results', details: err.message });
    }
});

module.exports = router;