import os
import requests
from urllib.parse import urlparse
from pathlib import Path
from dotenv import load_dotenv
import pymysql
import sys
import boto3
from botocore.exceptions import NoCredentialsError, ClientError

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

def initialize_s3_client():
    """
    Initialize AWS S3 client
    """
    try:
        # Get AWS credentials from environment
        aws_access_key = os.getenv('AWS_ACCESS_KEY_ID')
        aws_secret_key = os.getenv('AWS_SECRET_ACCESS_KEY')
        aws_region = os.getenv('AWS_REGION', 'us-east-1')
        
        if not aws_access_key or not aws_secret_key:
            print("⚠ AWS credentials not found in .env file")
            return None, None
        
        # Get bucket name
        bucket_name = os.getenv('S3_BUCKET_NAME')
        if not bucket_name:
            print("⚠ S3_BUCKET_NAME not found in .env file")
            return None, None
        
        # Initialize S3 client
        s3_client = boto3.client(
            's3',
            aws_access_key_id=aws_access_key,
            aws_secret_access_key=aws_secret_key,
            region_name=aws_region
        )
        
        print(f"✓ Connected to AWS S3 (Region: {aws_region}, Bucket: {bucket_name})")
        return s3_client, bucket_name
        
    except Exception as e:
        print(f"⚠ Failed to initialize S3 client: {e}")
        return None, None

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

def upload_to_s3(s3_client, bucket_name, local_path, s3_key):
    """
    Upload a file to S3
    """
    try:
        # Upload file
        s3_client.upload_file(
            local_path,
            bucket_name,
            s3_key,
            ExtraArgs={'ContentType': 'image/jpeg'}  # Adjust based on file type
        )
        
        # Construct S3 URL
        aws_region = os.getenv('AWS_REGION', 'us-east-1')
        if aws_region == 'us-east-1':
            s3_url = f"https://{bucket_name}.s3.amazonaws.com/{s3_key}"
        else:
            s3_url = f"https://{bucket_name}.s3.{aws_region}.amazonaws.com/{s3_key}"
        
        return True, s3_url
        
    except FileNotFoundError:
        print(f"  ✗ File not found: {local_path}")
        return False, None
    except NoCredentialsError:
        print(f"  ✗ AWS credentials not available")
        return False, None
    except ClientError as e:
        print(f"  ✗ S3 upload error: {e}")
        return False, None
    except Exception as e:
        print(f"  ✗ Unexpected error during S3 upload: {e}")
        return False, None

def update_database_image_path(connection, old_path, new_path):
    """
    Update all products with the old image path to use the new S3 path
    """
    try:
        with connection.cursor() as cursor:
            query = """
                UPDATE products 
                SET image_path = %s 
                WHERE image_path = %s
            """
            cursor.execute(query, (new_path, old_path))
            affected_rows = cursor.rowcount
            connection.commit()
            return affected_rows
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
    Main function to orchestrate the image download and S3 upload process
    """
    print("=" * 50)
    print("Product Image Downloader & S3 Uploader")
    print("=" * 50)
    
    # Get DATABASE_URL from environment
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        print("✗ DATABASE_URL not found in .env file")
        sys.exit(1)
    
    # Parse database connection parameters
    connection_params = parse_database_url(database_url)
    
    # Connect to database
    connection = connect_to_database(connection_params)
    
    # Initialize S3 client
    s3_client, bucket_name = initialize_s3_client()
    upload_to_s3_enabled = s3_client is not None
    
    if not upload_to_s3_enabled:
        print("⚠ S3 upload disabled - files will only be downloaded locally")
    
    try:
        # Fetch unique image paths
        images = fetch_image_paths(connection)
        
        if not images:
            print("No images to download")
            return
        
        # Create download directory
        download_dir = create_download_directory()
        print(f"✓ Using download directory: {download_dir.absolute()}")
        
        # S3 folder prefix (optional)
        s3_folder = os.getenv('S3_FOLDER_PREFIX', 'products')
        
        # Download and upload images
        print(f"\nProcessing {len(images)} images...")
        print("-" * 50)
        
        successful_downloads = 0
        failed_downloads = 0
        successful_uploads = 0
        failed_uploads = 0
        database_updates = 0
        
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
            if download_image(image_path, save_path):
                print(f"  ✓ Downloaded: {unique_filename}")
                successful_downloads += 1
                
                # Upload to S3 if enabled
                if upload_to_s3_enabled:
                    s3_key = f"{s3_folder}/{unique_filename}"
                    print(f"  → Uploading to S3: {s3_key}")
                    
                    success, s3_url = upload_to_s3(s3_client, bucket_name, str(save_path), s3_key)
                    
                    if success:
                        print(f"  ✓ Uploaded to S3: {s3_url}")
                        successful_uploads += 1
                        
                        # Update database with new S3 URL
                        print(f"  → Updating database...")
                        updated_rows = update_database_image_path(connection, image_path, s3_url)
                        
                        if updated_rows > 0:
                            print(f"  ✓ Updated {updated_rows} product(s) in database")
                            database_updates += updated_rows
                        else:
                            print(f"  ⚠ No database rows updated")
                    else:
                        failed_uploads += 1
                
            else:
                failed_downloads += 1
        
        # Print summary
        print("\n" + "=" * 50)
        print("Summary")
        print("=" * 50)
        print(f"✓ Successful downloads: {successful_downloads}")
        print(f"✗ Failed downloads: {failed_downloads}")
        
        if upload_to_s3_enabled:
            print(f"✓ Successful S3 uploads: {successful_uploads}")
            print(f"✗ Failed S3 uploads: {failed_uploads}")
            print(f"✓ Database rows updated: {database_updates}")
        
        print(f"📁 Images saved to: {download_dir.absolute()}")
        
    except Exception as e:
        print(f"\n✗ Error during process: {e}")
        import traceback
        traceback.print_exc()
    finally:
        # Close database connection
        connection.close()
        print("\n✓ Database connection closed")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n✗ Process interrupted by user")
        sys.exit(1)