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

        res.json(cart);
    } catch (err) {
        console.error('Error retrieving cart items:', err.message);
        res.status(500).json({ error: 'Error retrieving cart items', details: err.message });
    }
});

// Add or update cart item
router.post('/', async (req, res) => {
    try {
        const { user_id, product_id, quantity } = req.body;

        if (!user_id || !product_id || quantity === undefined) {
            return res.status(400).json({ error: 'user_id, product_id, and quantity are required' });
        }

        // Check if the user exists, create if not
        let user = await prisma.users.findUnique({
            where: { user_id: user_id }
        });

        if (!user) {
            user = await prisma.users.create({
                data: { user_id: user_id }
            });
        }

        // Check if the product exists
        const product = await prisma.products.findUnique({
            where: { product_id: product_id }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Fetch or create the cart for the user
        let cart = await prisma.cart.findFirst({
            where: { user_id: user_id },
            include: {
                cart_items: {
                    include: {
                        products: {
                            include: {
                                product_store: {
                                    include: {
                                        stores: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        if (!cart) {
            cart = await prisma.cart.create({
                data: {
                    user_id: user_id,
                    cart_items: {
                        create: []
                    }
                },
                include: {
                    cart_items: {
                        include: {
                            products: {
                                include: {
                                    product_store: {
                                        include: {
                                            stores: true
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });
        }

        if (quantity === 0) {
            // Remove the product from the cart
            await prisma.cart_items.deleteMany({
                where: {
                    cart_id: cart.id,
                    product_id: product_id
                }
            });
        } else {
            // Add or update the product in the user's cart
            await prisma.cart_items.upsert({
                where: {
                    cart_id_product_id: {
                        cart_id: cart.id,
                        product_id: product_id
                    }
                },
                update: {
                    quantity: quantity
                },
                create: {
                    cart_id: cart.id,
                    product_id: product_id,
                    quantity: quantity
                }
            });
        }

        // Retrieve the updated cart with cart items
        cart = await prisma.cart.findFirst({
            where: { user_id: user_id },
            include: {
                cart_items: {
                    include: {
                        products: {
                            include: {
                                product_store: {
                                    include: {
                                        stores: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });

        // Calculate min and max prices from cart items
        const prices = cart.cart_items.flatMap(cartItem => cartItem.products.product_store.map(ps => ps.price));
        const min_price = Math.min(...prices);
        const max_price = Math.max(...prices);

        // Prepare response data
        const responseData = {
            id: cart.id,
            user_id: cart.user_id,
            min_price,
            max_price,
            cart_items: cart.cart_items.map(cartItem => ({
                id: cartItem.id,
                cart_id: cartItem.cart_id,
                product_id: cartItem.product_id,
                quantity: cartItem.quantity,
                products: {
                    product_id: cartItem.products.product_id,
                    product_name: cartItem.products.product_name,
                    description: cartItem.products.description,
                    price: cartItem.products.price,
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
                        store_image: ps.stores?.store_image
                    }))
                }
            }))
        };

        console.log(`User ${user_id} updated their cart with product ${product_id} and quantity ${quantity}`);
        res.json(responseData);
    } catch (err) {
        console.error('Error updating cart:', err.message);
        res.status(500).json({ error: 'Error updating cart', details: err.message });
    }
});

module.exports = router;