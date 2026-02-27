import os
from dotenv import load_dotenv
import psycopg2

load_dotenv()

db_url = os.getenv("SUPABASE_DB_URL")
if not db_url:
    print("No DB URL")
    exit(1)

try:
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cur = conn.cursor()

    tables = [
        "bot_tests", 
        "bot_questions", 
        "bot_options", 
        "bot_dictionaries", 
        "bot_dictionary_words", 
        "bot_classes", 
        "bot_students"
    ]

    for table in tables:
        print(f"Fixing RLS for {table}...")
        cur.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY;")
        cur.execute(f"DROP POLICY IF EXISTS \"Allow all\" ON {table};")
        cur.execute(f"CREATE POLICY \"Allow all\" ON {table} FOR ALL USING (true) WITH CHECK (true);")
    
    print("Done!")

except Exception as e:
    print(f"Error: {e}")
