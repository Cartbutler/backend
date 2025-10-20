const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

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

        // Validate product exists
        const product = await prisma.products.findUnique({
            where: { product_id: product_id }
        });

        if (!product) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Execute all operations in a transaction
        const updatedCart = await prisma.$transaction(async (tx) => {
            // Ensure user and cart exist
            await ensureUser(user_id, tx);
            const cart = await ensureCart(user_id, tx);

            // Update cart item and recalculate quantity
            await updateCartItem(cart.id, product_id, quantity, tx);

            // Return the updated cart with all details
            return getCartWithDetails(user_id, tx);
        });

        if (!updatedCart) {
            return res.status(404).json({ error: 'Cart not found after update' });
        }

        console.log(`User ${user_id} updated their cart with product ${product_id} and quantity ${quantity}`);
        res.json(updatedCart);
    } catch (err) {
        console.error('Error updating cart:', err.message);
        res.status(500).json({ error: 'Error updating cart', details: err.message });
    }
});

async function fetchOrCreateCart(user_id, txClient = null) {
    if (txClient) {
        // We're in a transaction, ensure user and cart exist
        await ensureUser(user_id, txClient);
        await ensureCart(user_id, txClient);
        return getCartWithDetails(user_id, txClient);
    } else {
        // Not in a transaction, handle with our own transaction
        return prisma.$transaction(async (tx) => {
            await ensureUser(user_id, tx);
            await ensureCart(user_id, tx);
            return getCartWithDetails(user_id, tx);
        });
    }
}

async function ensureUser(user_id, tx) {
    let user = await tx.users.findUnique({
        where: { user_id }
    });

    if (!user) {
        user = await tx.users.create({
            data: { user_id }
        });
    }

    return user;
}

async function ensureCart(user_id, tx) {
    let cart = await tx.cart.findFirst({
        where: { user_id }
    });

    if (!cart) {
        cart = await tx.cart.create({
            data: {
                user_id,
                quantity: 0
            }
        });
    }

    return cart;
}

async function getCartWithDetails(user_id, client) {
    const cart = await client.cart.findFirst({
        where: { user_id },
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

    if (!cart) return null;

    const prices = cart.cart_items.flatMap(cartItem =>
        cartItem.products.product_store.map(ps => ps.price)
    );
    const min_price = prices.length ? Math.min(...prices) : 0;
    const max_price = prices.length ? Math.max(...prices) : 0;

    return {
        ...cart,
        min_price,
        max_price,
    };
}

async function updateCartItem(cart_id, product_id, quantity, tx) {
    // Handle cart item based on quantity
    if (quantity === 0) {
        // Remove the product from the cart
        await tx.cart_items.deleteMany({
            where: {
                cart_id: cart_id,
                product_id: product_id
            }
        });
    } else {
        // Add or update the product in the cart
        await tx.cart_items.upsert({
            where: {
                cart_id_product_id: {
                    cart_id: cart_id,
                    product_id: product_id
                }
            },
            update: {
                quantity: quantity
            },
            create: {
                cart_id: cart_id,
                product_id: product_id,
                quantity: quantity
            }
        });
    }

    // Count the number of unique products in the cart
    const uniqueProductCount = await tx.cart_items.count({
        where: { cart_id: cart_id }
    });
    
    // Update cart with the count of unique products
    await tx.cart.update({
        where: { id: cart_id },
        data: { 
            quantity: uniqueProductCount
        }
    });
}

module.exports = router;