import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

DB_URL = "postgresql://postgres.lxppxnawxmcfebmzdgil:LessonLab2026Pro@aws-1-eu-central-1.pooler.supabase.com:5432/postgres"

def test_conn():
    try:
        print("Connecting to Supabase...")
        conn = psycopg2.connect(DB_URL)
        cur = conn.cursor()
        print("Connected!")
        
        cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'")
        tables = cur.fetchall()
        print("\nExisting Tables:")
        for t in tables:
            print(f"- {t[0]}")
            
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    test_conn()
