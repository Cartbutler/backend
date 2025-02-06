# CartButler API

CartButler API is a Node.js application that provides various endpoints for managing categories, products, customers, and more. It uses Express.js for the server, Prisma for database interactions, and Multer for file uploads.

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
2. Install the dependecies:
```npm install```

3. Set up the environment variables: 
Create a .env file in the root directory and add the following:
```DATABASE_URL=mysql://cartbutler8946:conestoga8946@104.197.180.231:3306/cartbutler8946```
4. Run the Prisma migrations:
```npx prisma migrate dev```

# Usage
1. Start the server:
```node index.js```
2. The server will be running at http://localhost:5000.

# Endpoints
Root Route
GET /
Returns a welcome message.
```curl http://localhost:5000/```

Upload an Image
POST /upload

Uploads an image file.
```curl -X POST -F "image=@/path/to/your/image.jpg" http://localhost:5000/upload```

List All Categories
GET /categories
Returns a list of all categories.

```curl http://localhost:5000/categories```

Product Suggestions
GET /suggestions
Returns product suggestions based on a query parameter.
```curl http://localhost:5000/suggestions?query=example```

# Environment Variables
The following environment variables need to be set in the .env file:

DATABASE_URL: The connection string for the database.
