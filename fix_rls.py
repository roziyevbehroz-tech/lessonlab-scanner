import psycopg2
import os
from dotenv import load_dotenv

def main():
    load_dotenv()
    db_url = os.getenv("SUPABASE_DB_URL")
    if not db_url:
        print("No SUPABASE_DB_URL found")
        return

    try:
        conn = psycopg2.connect(db_url)
        conn.autocommit = True
        with conn.cursor() as cur:
            # Grant USAGE on sequences needed for inserting into bot_classes and bot_students
            cur.execute("GRANT USAGE, SELECT ON SEQUENCE bot_classes_id_seq TO anon;")
            cur.execute("GRANT USAGE, SELECT ON SEQUENCE bot_students_id_seq TO anon;")
            cur.execute("GRANT USAGE, SELECT ON SEQUENCE bot_classes_id_seq TO authenticated;")
            cur.execute("GRANT USAGE, SELECT ON SEQUENCE bot_students_id_seq TO authenticated;")
            
            # Just to be safe, grant all sequences
            cur.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;")
            
            # Also ensure insert permissions
            cur.execute("GRANT INSERT, SELECT, UPDATE ON ALL TABLES IN SCHEMA public TO anon, authenticated;")
            
            print("Successfully updated permissions for anon role on sequences & tables.")
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    main()
