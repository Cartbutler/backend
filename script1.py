import os
import requests
from urllib.parse import urlparse
from pathlib import Path
from dotenv import load_dotenv
import pymysql
import sys
import boto3
from botocore.exceptions import ClientError

# Load environment variables from .env file
load_dotenv()

def parse_database_url(database_url):
    """
    Parse the DATABASE_URL to extract connection parameters
    Format: mysql://user:pass@host:3306/dbname
    """
    try:
        parsed = urlparse(database_url)
        
        # Extract connection parameters
        connection_params = {
            'host': parsed.hostname,
            'port': parsed.port or 3306,
            'user': parsed.username,
            'password': parsed.password,
            'database': parsed.path.lstrip('/')
        }
        
        return connection_params
    except Exception as e:
        print(f"Error parsing DATABASE_URL: {e}")
        sys.exit(1)

def connect_to_database(connection_params):
    """
    Establish connection to MySQL database
    """
    try:
        connection = pymysql.connect(
            host=connection_params['host'],
            port=connection_params['port'],
            user=connection_params['user'],
            password=connection_params['password'],
            database=connection_params['database'],
            cursorclass=pymysql.cursors.DictCursor
        )
        print(f"✓ Connected to database: {connection_params['database']}")
        return connection
    except pymysql.Error as e:
        print(f"✗ Failed to connect to database: {e}")
        sys.exit(1)

def get_s3_client():
    """
    Create and return S3 client
    """
    try:
        s3_client = boto3.client(
            's3',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
            region_name=os.getenv('AWS_REGION', 'us-east-1')
        )
        print(f"✓ Connected to AWS S3")
        return s3_client
    except Exception as e:
        print(f"✗ Failed to create S3 client: {e}")
        sys.exit(1)

def fetch_image_paths(connection):
    """
    Fetch all unique image paths from the products table
    """
    try:
        with connection.cursor() as cursor:
            query = """
                SELECT DISTINCT image_path 
                FROM products 
                WHERE image_path IS NOT NULL AND image_path != ''
            """
            cursor.execute(query)
            results = cursor.fetchall()
            print(f"✓ Found {len(results)} unique images")
            return results
    except pymysql.Error as e:
        print(f"✗ Error fetching data: {e}")
        return []

def download_image(url, save_path):
    """
    Download an image from URL and save it locally
    """
    try:
        # Only process HTTP/HTTPS URLs
        if not url.startswith(('http://', 'https://')):
            print(f"  ✗ Not a valid URL: {url}")
            return False
        
        # Download with streaming to handle large files
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        # Write to file
        with open(save_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
        
        return True
        
    except Exception as e:
        print(f"  ✗ Error: {e}")
        # Remove partial file if it exists
        if os.path.exists(save_path):
            os.remove(save_path)
        return False

def upload_to_s3(s3_client, file_path, bucket_name, s3_key):
    """
    Upload a file to S3 bucket
    """
    try:
        # Determine content type based on file extension
        content_type_map = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
        }
        
        file_extension = Path(file_path).suffix.lower()
        content_type = content_type_map.get(file_extension, 'application/octet-stream')
        
        # Upload file
        s3_client.upload_file(
            str(file_path),
            bucket_name,
            s3_key,
            ExtraArgs={
                'ContentType': content_type,
                'ACL': 'public-read'  # Make images publicly accessible
            }
        )
        
        # Generate S3 URL
        s3_url = f"https://{bucket_name}.s3.amazonaws.com/{s3_key}"
        
        return s3_url
        
    except ClientError as e:
        print(f"  ✗ S3 upload error: {e}")
        return None
    except Exception as e:
        print(f"  ✗ Unexpected error: {e}")
        return None

def update_database_with_s3_url(connection, old_image_path, new_s3_url):
    """
    Update all products with the old image_path to use the new S3 URL
    """
    try:
        with connection.cursor() as cursor:
            query = """
                UPDATE products 
                SET image_path = %s 
                WHERE image_path = %s
            """
            cursor.execute(query, (new_s3_url, old_image_path))
            connection.commit()
            rows_affected = cursor.rowcount
            return rows_affected
    except pymysql.Error as e:
        print(f"  ✗ Database update error: {e}")
        connection.rollback()
        return 0

def create_download_directory():
    """
    Create a directory to store downloaded images
    """
    download_dir = Path("images")
    download_dir.mkdir(exist_ok=True)
    return download_dir

def get_unique_filename(download_dir, filename):
    """
    Generate a unique filename if the file already exists
    """
    save_path = download_dir / filename
    
    # If file doesn't exist, return original filename
    if not save_path.exists():
        return filename
    
    # Extract name and extension
    path = Path(filename)
    name = path.stem
    extension = path.suffix
    
    # Try adding numbers until we find an unused filename
    counter = 1
    while True:
        new_filename = f"{name}_{counter}{extension}"
        new_path = download_dir / new_filename
        if not new_path.exists():
            return new_filename
        counter += 1

def main():
    """
    Main function to orchestrate the image download and upload process
    """
    print("=" * 50)
    print("Product Image Migrator to S3")
    print("=" * 50)
    
    # Get environment variables
    database_url = os.getenv('DATABASE_URL')
    s3_bucket = os.getenv('S3_BUCKET_NAME')
    s3_folder = os.getenv('S3_FOLDER', 'products')  # Optional folder prefix in S3
    
    if not database_url:
        print("✗ DATABASE_URL not found in .env file")
        sys.exit(1)
    
    if not s3_bucket:
        print("✗ S3_BUCKET_NAME not found in .env file")
        sys.exit(1)
    
    if not os.getenv('AWS_ACCESS_KEY_ID') or not os.getenv('AWS_SECRET_ACCESS_KEY'):
        print("✗ AWS credentials not found in .env file")
        sys.exit(1)
    
    # Parse database connection parameters
    connection_params = parse_database_url(database_url)
    
    # Connect to database
    connection = connect_to_database(connection_params)
    
    # Connect to S3
    s3_client = get_s3_client()
    
    try:
        # Fetch unique image paths
        images = fetch_image_paths(connection)
        
        if not images:
            print("No images to process")
            return
        
        # Create download directory
        download_dir = create_download_directory()
        print(f"✓ Using download directory: {download_dir.absolute()}")
        print(f"✓ S3 Bucket: {s3_bucket}")
        print(f"✓ S3 Folder: {s3_folder}")
        
        # Process images
        print(f"\nProcessing {len(images)} images...")
        print("-" * 50)
        
        successful_uploads = 0
        failed_downloads = 0
        failed_uploads = 0
        
        for idx, image in enumerate(images, 1):
            image_path = image['image_path']
            
            print(f"\n[{idx}/{len(images)}] URL: {image_path}")
            
            # Extract filename from image_path
            if '/' in image_path:
                original_filename = image_path.split('/')[-1]
            else:
                original_filename = image_path
            
            # Remove query parameters from filename if present
            if '?' in original_filename:
                original_filename = original_filename.split('?')[0]
            
            # Get unique filename to avoid conflicts
            unique_filename = get_unique_filename(download_dir, original_filename)
            save_path = download_dir / unique_filename
            
            # Show if filename was modified
            if unique_filename != original_filename:
                print(f"  ⚠ Filename conflict resolved: {unique_filename}")
            
            # Download the image
            if not download_image(image_path, save_path):
                failed_downloads += 1
                continue
            
            print(f"  ✓ Downloaded: {unique_filename}")
            
            # Upload to S3
            s3_key = f"{s3_folder}/{unique_filename}" if s3_folder else unique_filename
            s3_url = upload_to_s3(s3_client, save_path, s3_bucket, s3_key)
            
            if not s3_url:
                failed_uploads += 1
                continue
            
            print(f"  ✓ Uploaded to S3: {s3_url}")
            
            # Update database
            rows_updated = update_database_with_s3_url(connection, image_path, s3_url)
            
            if rows_updated > 0:
                print(f"  ✓ Updated {rows_updated} product(s) in database")
                successful_uploads += 1
            else:
                print(f"  ⚠ Warning: No products updated")
        
        # Print summary
        print("\n" + "=" * 50)
        print("Migration Summary")
        print("=" * 50)
        print(f"✓ Successful uploads: {successful_uploads}")
        print(f"✗ Failed downloads: {failed_downloads}")
        print(f"✗ Failed uploads: {failed_uploads}")
        print(f"📁 Local images saved to: {download_dir.absolute()}")
        print(f"☁️  S3 Bucket: {s3_bucket}")
        
    except Exception as e:
        print(f"\n✗ Error during migration process: {e}")
    finally:
        # Close database connection
        connection.close()
        print("\n✓ Database connection closed")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n✗ Migration interrupted by user")
        sys.exit(1)