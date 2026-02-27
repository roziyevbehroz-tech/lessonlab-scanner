import sqlite3
import os

SQLITE_DB = "lessonlab.db"

def inspect_sqlite():
    if not os.path.exists(SQLITE_DB):
        print(f"SQLite DB {SQLITE_DB} not found!")
        return

    conn = sqlite3.connect(SQLITE_DB)
    cur = conn.cursor()

    try:
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = cur.fetchall()
        print(f"Tables in {SQLITE_DB}:")
        for t in tables:
            print(f"- {t[0]}")
            # print schema for each table
            cur.execute(f"PRAGMA table_info({t[0]})")
            info = cur.fetchall()
            print(f"  Columns: {[i[1] for i in info]}")
    except Exception as e:
        print(f"Inspection Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    inspect_sqlite()
