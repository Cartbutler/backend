# CartButler API

CartButler API is a Node.js application that provides various endpoints for managing categories, products, customers, and more. It uses Express.js for the server and Prisma for database interactions.

Api link
```sh
https://southern-shard-449119-d4.nn.r.appspot.com/
```

## Table of Contents

- [Installation](#installation)
- [Usage](#usage)
- [Endpoints](#endpoints)
- [Environment Variables](#environment-variables)

## Installation

1. Clone the repository:

   ```sh
   git clone https://github.com/yourusername/CartButler.git
   cd CartButler
   ```

2. Install the dependencies:
   ```sh
   npm install
   ```

3. Set up the environment variables:
   - Create a `.env` file in the root directory and add the following:
     ```sh
     DATABASE_URL=mysql://cartbutler8946:conestoga8946@104.197.180.231:3306/cartbutler8946
     ```

4. Run the Prisma migrations:
   ```sh
   npx prisma migrate dev
   ```

## Usage

1. Start the server:
   ```sh
   node index.js
   ```

2. The server will be running at [http://localhost:5000](http://localhost:5000).

## Endpoints

### Root Route
- **GET /**

  Returns a welcome message.

  ```sh
  curl http://localhost:5000/
  ```

### List All Categories
- **GET /categories**

  Returns a list of all categories.

  ```sh
  curl http://localhost:5000/categories
  ```

### Product Suggestions
- **GET /suggestions**

  Returns product suggestions based on a query parameter.

  ```sh
  curl http://localhost:5000/suggestions?query=example
  ```

### Search Products
- **GET /search**

  Searches for products based on a query or categoryID parameter. At least one of the parameters is required. The endpoint returns products based on the provided parameters, limited to 10 results, and sorted by creation date.

  ```sh
  curl http://localhost:5000/search?query=example&categoryID=1
  ```

### List All Products or Filter by Category
- **GET /products**

  Returns a list of all products or filters products by `category_id` if provided.

  ```sh
  curl http://localhost:5000/products
  ```

  To filter by `category_id`:

  ```sh
  curl http://localhost:5000/products?category_id=3
  ```

## Environment Variables

The following environment variables need to be set in the `.env` file:

- `DATABASE_URL`: The connection string for the database.