const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const fetchOrCreateCart = require('../utils/fetch_or_create_cart');

// Get shopping cart
router.get('/', async (req, res) => {
    try {
        const { user_id } = req.query;

        if (!user_id) {
            return res.status(400).json({ error: 'user_id is required' });
        }

        const cart = await fetchOrCreateCart(user_id);

        const prices = cart.cart_items.flatMap(cartItem =>
            cartItem.products.product_store.map(ps => ps.price)
        );
        const min_price = Math.min(...prices);
        const max_price = Math.max(...prices);

        const responseData = {
            id: cart.id,
            user_id: cart.user_id,
            cart_items: cart.cart_items.map(cartItem => ({
                id: cartItem.id,
                cart_id: cartItem.cart_id,
                product_id: cartItem.product_id,
                quantity: cartItem.quantity,
                products: {
                    product_id: cartItem.products.product_id,
                    product_name: cartItem.products.product_name,
                    description: cartItem.products.description,
                    min_price: Math.min(...cartItem.products.product_store.map(ps => ps.price)),
                    max_price: Math.max(...cartItem.products.product_store.map(ps => ps.price)),
                    stock: cartItem.products.stock,
                    category_id: cartItem.products.category_id,
                    image_path: cartItem.products.image_path,
                    created_at: cartItem.products.created_at,
                    category_name: cartItem.products.category_name,
                    language_id: cartItem.products.language_id,
                    product_store: cartItem.products.product_store.map(ps => ({
                        store_id: ps.store_id,
                        price: ps.price,
                        stock: ps.stock,
                        store_name: ps.stores?.store_name,
                        store_location: ps.stores?.store_location,
                        store_address: ps.stores?.store_address,
                        latitude: ps.stores?.latitude,
                        longitude: ps.stores?.longitude,
                        store_image: ps.stores?.store_image,
                    })),
                },
            })),
        };

        res.json(responseData);
    } catch (err) {
        console.error('Error retrieving cart items:', err.message);
        res.status(500).json({ error: 'Error retrieving cart items', details: err.message });
    }
});

module.exports = router;