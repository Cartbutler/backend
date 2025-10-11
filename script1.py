import os
import re
import requests
from pathlib import Path
from urllib.parse import urlparse
import mysql.connector
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

def parse_database_url(database_url):
    """
    Parse DATABASE_URL format: mysql://user:pass@host:3306/dbname
    Returns a dictionary with connection parameters
    """
    pattern = r'mysql://([^:]+):([^@]+)@([^:]+):(\d+)/(.+)'
    match = re.match(pattern, database_url)
    
    if not match:
        raise ValueError("Invalid DATABASE_URL format")
    
    return {
        'user': match.group(1),
        'password': match.group(2),
        'host': match.group(3),
        'port': int(match.group(4)),
        'database': match.group(5)
    }

def create_download_directory(directory='downloaded_images'):
    """Create directory for downloaded images if it doesn't exist"""
    Path(directory).mkdir(parents=True, exist_ok=True)
    return directory

def download_image_from_url(url, save_path):
    """Download image from URL"""
    try:
        response = requests.get(url, timeout=30, stream=True)
        response.raise_for_status()
        
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        print(f"✓ Downloaded: {url} -> {save_path}")
        return True
    except Exception as e:
        print(f"✗ Failed to download {url}: {str(e)}")
        return False

def copy_local_file(source_path, destination_path):
    """Copy image from local file system"""
    try:
        with open(source_path, 'rb') as src:
            with open(destination_path, 'wb') as dst:
                dst.write(src.read())
        print(f"✓ Copied: {source_path} -> {destination_path}")
        return True
    except Exception as e:
        print(f"✗ Failed to copy {source_path}: {str(e)}")
        return False

def is_url(path):
    """Check if the path is a URL"""
    return path.startswith('http://') or path.startswith('https://')

def download_images_from_database():
    """Main function to download all images from the products table"""
    
    # Get database connection details from environment
    database_url = os.getenv('DATABASE_URL')
    
    if not database_url:
        print("Error: DATABASE_URL not found in .env file")
        return
    
    # Parse database URL
    try:
        db_config = parse_database_url(database_url)
    except ValueError as e:
        print(f"Error: {str(e)}")
        return
    
    # Create download directory
    download_dir = create_download_directory('downloaded_images')
    
    # Connect to database
    connection = None
    try:
        print(f"Connecting to database: {db_config['database']} at {db_config['host']}")
        connection = mysql.connector.connect(**db_config)
        cursor = connection.cursor(dictionary=True)
        
        # Query to get all image paths
        query = "SELECT product_id, product_name, image_path FROM products WHERE image_path IS NOT NULL AND image_path != ''"
        cursor.execute(query)
        
        products = cursor.fetchall()
        total_products = len(products)
        
        print(f"\nFound {total_products} products with images")
        print("-" * 60)
        
        success_count = 0
        failed_count = 0
        
        # Download each image
        for idx, product in enumerate(products, 1):
            product_id = product['product_id']
            product_name = product['product_name']
            image_path = product['image_path']
            
            print(f"\n[{idx}/{total_products}] Processing: {product_name} (ID: {product_id})")
            
            # Generate safe filename
            file_extension = os.path.splitext(image_path)[1] or '.jpg'
            safe_filename = f"product_{product_id}_{re.sub(r'[^a-zA-Z0-9]', '_', product_name[:50])}{file_extension}"
            save_path = os.path.join(download_dir, safe_filename)
            
            # Download or copy the image
            if is_url(image_path):
                success = download_image_from_url(image_path, save_path)
            else:
                success = copy_local_file(image_path, save_path)
            
            if success:
                success_count += 1
            else:
                failed_count += 1
        
        # Summary
        print("\n" + "=" * 60)
        print("DOWNLOAD SUMMARY")
        print("=" * 60)
        print(f"Total products: {total_products}")
        print(f"Successfully downloaded: {success_count}")
        print(f"Failed: {failed_count}")
        print(f"Images saved to: {os.path.abspath(download_dir)}")
        
    except mysql.connector.Error as e:
        print(f"Database error: {str(e)}")
    except Exception as e:
        print(f"Error: {str(e)}")
    finally:
        if connection and connection.is_connected():
            cursor.close()
            connection.close()
            print("\nDatabase connection closed")

if __name__ == "__main__":
    print("=" * 60)
    print("IMAGE DOWNLOADER - Products Table")
    print("=" * 60)
    download_images_from_database()