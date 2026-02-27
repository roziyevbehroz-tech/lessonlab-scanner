import sqlite3
import psycopg2
import os
from dotenv import load_dotenv

load_dotenv()

SQLITE_DB = "lessonlab.db"
SUPABASE_URL = os.getenv("SUPABASE_DB_URL")

def migrate():
    if not os.path.exists(SQLITE_DB):
        print(f"SQLite DB {SQLITE_DB} not found!")
        return

    print(f"Connecting to SQLite: {SQLITE_DB}")
    sl_conn = sqlite3.connect(SQLITE_DB)
    sl_cur = sl_conn.cursor()

    print(f"Connecting to Supabase...")
    pg_conn = psycopg2.connect(SUPABASE_URL)
    pg_cur = pg_conn.cursor()

    try:
        # 1. Migrate Users
        print("Migrating users...")
        sl_cur.execute("SELECT id, full_name, username FROM users")
        users = sl_cur.fetchall()
        for u in users:
            pg_cur.execute(
                "INSERT INTO bot_users (id, full_name, username) VALUES (%s, %s, %s) ON CONFLICT (id) DO NOTHING",
                u
            )
        print(f"Migrated {len(users)} users.")

        # 2. Migrate Tests
        print("Migrating tests...")
        sl_cur.execute("SELECT id, user_id, title, created_at FROM tests")
        tests = sl_cur.fetchall()
        for t in tests:
            old_tid = t[0]
            pg_cur.execute(
                "INSERT INTO bot_tests (id, user_id, title, created_at) VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                t
            )
            
            # Migrate Questions for this test
            sl_cur.execute("SELECT id, text, hint FROM questions WHERE test_id = ?", (old_tid,))
            questions = sl_cur.fetchall()
            for q in questions:
                old_qid = q[0]
                pg_cur.execute(
                    "INSERT INTO bot_questions (id, test_id, text, hint) VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                    (old_qid, old_tid, q[1], q[2])
                )
                
                # Migrate Options for this question
                sl_cur.execute("SELECT text, is_correct FROM options WHERE question_id = ?", (old_qid,))
                options = sl_cur.fetchall()
                for opt in options:
                    pg_cur.execute(
                        "INSERT INTO bot_options (question_id, text, is_correct) VALUES (%s, %s, %s)",
                        (old_qid, opt[0], bool(opt[1]))
                    )
        
        # 3. Migrate Dictionaries
        print("Migrating dictionaries...")
        # SQLite 'dictionaries' has both 'title' and 'name'. Supabase 'bot_dictionaries' has 'name'.
        sl_cur.execute("SELECT id, user_id, name, created_at FROM dictionaries")
        dicts = sl_cur.fetchall()
        for d in dicts:
            old_did = d[0]
            pg_cur.execute(
                "INSERT INTO bot_dictionaries (id, user_id, name, created_at) VALUES (%s, %s, %s, %s) ON CONFLICT (id) DO NOTHING",
                d
            )
            
            # Migrate Words
            sl_cur.execute("SELECT word, translation FROM dictionary_words WHERE dictionary_id = ?", (old_did,))
            words = sl_cur.fetchall()
            for w in words:
                pg_cur.execute(
                    "INSERT INTO bot_dictionary_words (dictionary_id, word, translation) VALUES (%s, %s, %s)",
                    (old_did, w[0], w[1])
                )

        pg_conn.commit()
        print("Migration completed successfully!")

    except Exception as e:
        print(f"Migration Error: {e}")
        pg_conn.rollback()
    finally:
        sl_conn.close()
        pg_conn.close()

if __name__ == "__main__":
    migrate()
