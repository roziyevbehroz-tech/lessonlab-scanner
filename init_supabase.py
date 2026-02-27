from database import Database
from dotenv import load_dotenv
import os

load_dotenv()

def init():
    try:
        print("Initializing Database class (Supabase)...")
        db = Database()
        print("Initialization successful!")
        
        # Verify bot_users table
        with db.conn.cursor() as cur:
            cur.execute("SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'bot_%'")
            tables = cur.fetchall()
            print("\nBot Tables Created:")
            for t in tables:
                print(f"- {t[0]}")
                
    except Exception as e:
        print(f"Error during initialization: {e}")

if __name__ == "__main__":
    init()
