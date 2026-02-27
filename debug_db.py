from database import Database
import os
from dotenv import load_dotenv

load_dotenv()

db = Database()

def debug():
    print("--- Database Debug ---")
    try:
        with db.conn.cursor() as cur:
            # 1. List all users
            cur.execute("SELECT id, full_name FROM bot_users LIMIT 10")
            users = cur.fetchall()
            print(f"Users in DB: {users}")
            
            # 2. List recent tests
            cur.execute("SELECT id, user_id, title FROM bot_tests ORDER BY id DESC LIMIT 10")
            tests = cur.fetchall()
            print(f"Recent tests: {tests}")
            
            # 3. Check if any tests exist at all
            cur.execute("SELECT COUNT(*) FROM bot_tests")
            count = cur.fetchone()[0]
            print(f"Total tests in DB: {count}")
            
    except Exception as e:
        print(f"Debug Error: {e}")

if __name__ == "__main__":
    debug()
