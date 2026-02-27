import sqlite3
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

SQLITE_DB = "lessonlab.db"
SUPABASE_URL = os.getenv("SUPABASE_DB_URL")
USER_ID = 204135

def debug():
    print(f"--- Full Debug for User {USER_ID} ---")
    
    # Check SQLite
    if os.path.exists(SQLITE_DB):
        print(f"\n[SQLite] Checking {SQLITE_DB}...")
        sl_conn = sqlite3.connect(SQLITE_DB)
        sl_cur = sl_conn.cursor()
        
        sl_cur.execute("SELECT id, full_name, username FROM users WHERE id = ?", (USER_ID,))
        user = sl_cur.fetchone()
        print(f"User in SQLite: {user}")
        
        sl_cur.execute("SELECT id, title FROM tests WHERE user_id = ?", (USER_ID,))
        tests = sl_cur.fetchall()
        print(f"Tests in SQLite: {len(tests)} tests found. {tests}")
        
        sl_cur.execute("SELECT id, name FROM dictionaries WHERE user_id = ?", (USER_ID,))
        dicts = sl_cur.fetchall()
        print(f"Dictionaries in SQLite: {len(dicts)} found. {dicts}")
        
        sl_conn.close()
    else:
        print(f"\n[SQLite] {SQLITE_DB} not found!")

    # Check Supabase
    print(f"\n[Supabase] Connecting...")
    try:
        pg_conn = psycopg2.connect(SUPABASE_URL)
        pg_cur = pg_conn.cursor()
        
        pg_cur.execute("SELECT id, full_name FROM bot_users WHERE id = %s", (USER_ID,))
        user_pg = pg_cur.fetchone()
        print(f"User in Supabase: {user_pg}")
        
        pg_cur.execute("SELECT id, title FROM bot_tests WHERE user_id = %s", (USER_ID,))
        tests_pg = pg_cur.fetchall()
        print(f"Tests in Supabase: {len(tests_pg)} tests found. {tests_pg}")
        
        pg_cur.execute("SELECT id, name FROM bot_dictionaries WHERE user_id = %s", (USER_ID,))
        dicts_pg = pg_cur.fetchall()
        print(f"Dictionaries in Supabase: {len(dicts_pg)} found. {dicts_pg}")
        
        pg_conn.close()
    except Exception as e:
        print(f"Supabase Error: {e}")

if __name__ == "__main__":
    debug()
