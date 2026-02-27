import os
from dotenv import load_dotenv
import psycopg2

load_dotenv()

DB_URL = os.getenv("SUPABASE_DB_URL")

try:
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        # Add remote_id column
        cur.execute("ALTER TABLE bot_students ADD COLUMN IF NOT EXISTS remote_id VARCHAR(50);")
        print("Successfully added remote_id column to bot_students table.")
except Exception as e:
    print(f"Error during migration: {e}")
finally:
    if 'conn' in locals() and conn:
        conn.close()
