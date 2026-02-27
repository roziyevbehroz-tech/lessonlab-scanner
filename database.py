import psycopg2
from psycopg2.extras import RealDictCursor
import os
import json
from datetime import date

class Database:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(Database, cls).__new__(cls)
            cls._instance.initialized = False
        return cls._instance

    def __init__(self):
        if self.initialized:
            return
        
        # Use port 6543 for Transaction Mode (better for serverless/pooling)
        self.db_url = os.getenv("SUPABASE_DB_URL")
        if not self.db_url:
            raise ValueError("SUPABASE_DB_URL not found in environment")
            
        try:
            self.conn = psycopg2.connect(self.db_url)
            self.conn.autocommit = True
            self._init_tables()
            self.initialized = True
            print("DATABASE: Supabase connection established (Singleton)")
        except Exception as e:
            print(f"CRITICAL DATABASE ERROR: {e}")
            raise e

    def _ensure_connection(self):
        """Check if connection is alive. If not, reconnect."""
        try:
            # Quick health check — runs a trivial query
            with self.conn.cursor() as cur:
                cur.execute("SELECT 1")
        except (psycopg2.InterfaceError, psycopg2.OperationalError, psycopg2.DatabaseError):
            print("[DB] Connection lost! Reconnecting...")
            self._reconnect()

    def _reconnect(self):
        """Close the old connection and establish a new one."""
        try:
            self.conn.close()
        except Exception:
            pass  # Already dead, ignore
        
        try:
            self.conn = psycopg2.connect(self.db_url)
            self.conn.autocommit = True
            print("[DB] Reconnected successfully!")
        except Exception as e:
            print(f"[DB] CRITICAL: Reconnection failed: {e}")
            raise e


    def _init_tables(self):
        with self.conn.cursor() as cur:
            # We use bot_ prefix for bot-specific tables to avoid collision with web project
            tables = [
                """CREATE TABLE IF NOT EXISTS bot_tests (
                    id SERIAL PRIMARY KEY, 
                    user_id BIGINT, 
                    title TEXT, 
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                """CREATE TABLE IF NOT EXISTS bot_questions (
                    id SERIAL PRIMARY KEY, 
                    test_id INT REFERENCES bot_tests(id) ON DELETE CASCADE, 
                    text TEXT, 
                    hint TEXT
                )""",
                """CREATE TABLE IF NOT EXISTS bot_options (
                    id SERIAL PRIMARY KEY, 
                    question_id INT REFERENCES bot_questions(id) ON DELETE CASCADE, 
                    text TEXT, 
                    is_correct BOOLEAN
                )""",
                """CREATE TABLE IF NOT EXISTS bot_dictionaries (
                    id SERIAL PRIMARY KEY, 
                    user_id BIGINT, 
                    name TEXT, 
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                """CREATE TABLE IF NOT EXISTS bot_dictionary_words (
                    id SERIAL PRIMARY KEY, 
                    dictionary_id INT REFERENCES bot_dictionaries(id) ON DELETE CASCADE, 
                    word TEXT, 
                    translation TEXT
                )""",
                """CREATE TABLE IF NOT EXISTS bot_classes (
                    id SERIAL PRIMARY KEY, 
                    user_id BIGINT, 
                    name TEXT, 
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                """CREATE TABLE IF NOT EXISTS bot_students (
                    id SERIAL PRIMARY KEY, 
                    class_id INT REFERENCES bot_classes(id) ON DELETE CASCADE, 
                    student_id_in_class INT, 
                    full_name TEXT,
                    remote_id VARCHAR(50)
                )""",
                """CREATE TABLE IF NOT EXISTS bot_group_sessions (
                    id SERIAL PRIMARY KEY, 
                    chat_id BIGINT, 
                    user_id BIGINT, 
                    test_ids TEXT, 
                    settings TEXT, 
                    status TEXT DEFAULT 'active', 
                    scores TEXT DEFAULT '{}', 
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )""",
                """CREATE TABLE IF NOT EXISTS bot_users (
                    id BIGINT PRIMARY KEY, 
                    full_name TEXT, 
                    username TEXT, 
                    last_active_date DATE, 
                    tests_completed_today INTEGER DEFAULT 0
                )"""
            ]
            for t in tables:
                cur.execute(t)

    # === Test CRUD ===
    def save_full_test(self, user_id, data):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO bot_tests (user_id, title) VALUES (%s, %s) RETURNING id", (user_id, data['title']))
            test_id = cur.fetchone()[0]
            for q in data['questions']:
                cur.execute("INSERT INTO bot_questions (test_id, text, hint) VALUES (%s, %s, %s) RETURNING id", 
                                (test_id, q['text'], q.get('hint')))
                q_id = cur.fetchone()[0]
                for opt in q['options']:
                    cur.execute("INSERT INTO bot_options (question_id, text, is_correct) VALUES (%s, %s, %s)",
                                    (q_id, opt['text'], opt['is_correct']))
            return test_id

    def get_user_tests(self, user_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, title FROM bot_tests WHERE user_id=%s", (user_id,))
            return cur.fetchall()

    def get_test_title(self, test_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("SELECT title FROM bot_tests WHERE id=%s", (test_id,))
            row = cur.fetchone()
            return row[0] if row else "Noma'lum Test"

    def get_question_count(self, test_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM bot_questions WHERE test_id=%s", (test_id,))
            return cur.fetchone()[0]

    def delete_test(self, test_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM bot_tests WHERE id=%s", (test_id,))

    def rename_test(self, test_id, new_title):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("UPDATE bot_tests SET title=%s WHERE id=%s", (new_title, test_id))

    def add_single_question(self, test_id, q):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO bot_questions (test_id, text, hint) VALUES (%s, %s, %s) RETURNING id", 
                            (test_id, q['text'], q.get('hint')))
            q_id = cur.fetchone()[0]
            for opt in q['options']:
                cur.execute("INSERT INTO bot_options (question_id, text, is_correct) VALUES (%s, %s, %s)",
                                (q_id, opt['text'], opt['is_correct']))
            return q_id

    def add_questions_to_test(self, test_id, questions):
        ids = []
        for q in questions:
            ids.append(self.add_single_question(test_id, q))
        return ids

    def find_duplicate_question(self, test_id, q_data):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM bot_questions WHERE test_id=%s AND LOWER(TRIM(text))=LOWER(TRIM(%s))",
                (test_id, q_data['text'])
            )
            rows = cur.fetchall()
            
            for (q_id,) in rows:
                cur.execute(
                    "SELECT LOWER(TRIM(text)), is_correct FROM bot_options WHERE question_id=%s ORDER BY text",
                    (q_id,)
                )
                existing_opts = cur.fetchall()
                new_opts = sorted([(o['text'].lower().strip(), o['is_correct']) for o in q_data['options']])
                if existing_opts == new_opts:
                    return q_id
            return None

    def delete_questions(self, question_ids):
        if not question_ids: return
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM bot_questions WHERE id IN %s", (tuple(question_ids),))

    def get_test_questions(self, test_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, text, hint FROM bot_questions WHERE test_id=%s", (test_id,))
            rows = cur.fetchall()
            result = []
            for q_id, q_text, q_hint in rows:
                cur.execute("SELECT text, is_correct FROM bot_options WHERE question_id=%s", (q_id,))
                opts = cur.fetchall()
                result.append({
                    'id': q_id,
                    'text': q_text,
                    'hint': q_hint,
                    'options': [{'text': o[0], 'is_correct': o[1]} for o in opts]
                })
            return result

    def get_test_data_json(self, test_id, class_id=None):
        """Prepare JSON data format for scanner webapp"""
        self._ensure_connection()
        test_data = {
            'title': self.get_test_title(test_id),
            'questions': [],
            'students': []
        }
        
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, text FROM bot_questions WHERE test_id=%s ORDER BY id", (test_id,))
            questions = cur.fetchall()
            for q_id, q_text in questions:
                cur.execute("SELECT text, is_correct FROM bot_options WHERE question_id=%s ORDER BY id", (q_id,))
                options = [{'text': opt[0], 'is_correct': opt[1]} for opt in cur.fetchall()]
                correct_idx = next((i for i, o in enumerate(options) if o['is_correct']), 0)
                
                test_data['questions'].append({
                    'id': q_id,
                    'text': q_text,
                    'options': [opt['text'] for opt in options],
                    'correct': correct_idx
                })

        if class_id:
            test_data['class_name'] = self.get_class_name(class_id)
            with self.conn.cursor() as cur:
                cur.execute("SELECT student_id_in_class, full_name, remote_id FROM bot_students WHERE class_id=%s ORDER BY student_id_in_class", (class_id,))
                students = cur.fetchall()
                test_data['students'] = [{'id': s[0], 'name': s[1], 'remote_id': s[2]} for s in students]

        return test_data

    # === Sinf ===
    def get_user_classes(self, user_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("SELECT id, name FROM bot_classes WHERE user_id=%s", (user_id,))
            return cur.fetchall()

    def get_class_students(self, class_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT student_id_in_class, full_name FROM bot_students WHERE class_id=%s ORDER BY student_id_in_class",
                (class_id,)
            )
            return cur.fetchall()

    def get_class_name(self, class_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("SELECT name FROM bot_classes WHERE id=%s", (class_id,))
            row = cur.fetchone()
            return row[0] if row else "Noma'lum sinf"

    # === Guruh sessiyalari ===
    def save_group_session(self, chat_id, user_id, test_ids, settings):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO bot_group_sessions (chat_id, user_id, test_ids, settings, status, scores) VALUES (%s,%s,%s,%s,%s,%s) RETURNING id",
                (chat_id, user_id, json.dumps(test_ids), json.dumps(settings), 'active', '{}')
            )
            return cur.fetchone()[0]

    def get_active_group_session(self, chat_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id, user_id, test_ids, settings, scores FROM bot_group_sessions WHERE chat_id=%s AND status='active' ORDER BY id DESC LIMIT 1",
                (chat_id,)
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                'id': row[0],
                'user_id': row[1],
                'test_ids': json.loads(row[2]),
                'settings': json.loads(row[3]),
                'scores': json.loads(row[4])
            }

    def update_group_scores(self, session_id, scores):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE bot_group_sessions SET scores=%s WHERE id=%s",
                (json.dumps(scores), session_id)
            )

    def finish_group_session(self, session_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("UPDATE bot_group_sessions SET status='finished' WHERE id=%s", (session_id,))

    # === Analytics & User Tracking ===
    def update_user_activity(self, user_id, full_name, username):
        today = date.today().isoformat()
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                """INSERT INTO bot_users (id, full_name, username, last_active_date) 
                   VALUES (%s, %s, %s, %s) 
                   ON CONFLICT (id) DO UPDATE 
                   SET full_name = EXCLUDED.full_name, 
                       username = EXCLUDED.username, 
                       last_active_date = EXCLUDED.last_active_date""",
                (user_id, full_name, username, today)
            )

    def increment_user_test_count(self, user_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "UPDATE bot_users SET tests_completed_today = tests_completed_today + 1 WHERE id=%s",
                (user_id,)
            )

    def get_admin_stats(self):
        today = date.today().isoformat()
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM bot_users")
            total_users = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM bot_users WHERE last_active_date=%s", (today,))
            active_today = cur.fetchone()[0]
            cur.execute("SELECT SUM(tests_completed_today) FROM bot_users")
            tests_today = cur.fetchone()[0] or 0
            
            return {
                'total_users': total_users,
                'active_today': active_today,
                'tests_today': tests_today
            }

    def get_top_active_users(self, limit=3):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT full_name, tests_completed_today FROM bot_users ORDER BY tests_completed_today DESC LIMIT %s",
                (limit,)
            )
            return cur.fetchall()

    def reset_daily_test_counts(self):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("UPDATE bot_users SET tests_completed_today = 0")

    # === Dictionary Management ===
    def get_user_dictionaries(self, user_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id, name FROM bot_dictionaries WHERE user_id=%s ORDER BY created_at DESC", 
                (user_id,)
            )
            return cur.fetchall()

    def add_dictionary(self, user_id, name):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("INSERT INTO bot_dictionaries (user_id, name) VALUES (%s, %s) RETURNING id", (user_id, name))
            return cur.fetchone()[0]

    def delete_dictionary(self, dict_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM bot_dictionaries WHERE id=%s", (dict_id,))

    def get_dictionary_words(self, dict_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id, word, translation FROM bot_dictionary_words WHERE dictionary_id=%s",
                (dict_id,)
            )
            return cur.fetchall()

    def add_dictionary_word(self, dict_id, word, translation):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute(
                "INSERT INTO bot_dictionary_words (dictionary_id, word, translation) VALUES (%s, %s, %s)",
                (dict_id, word, translation)
            )

    def delete_dictionary_word(self, word_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("DELETE FROM bot_dictionary_words WHERE id=%s", (word_id,))

    def get_dictionary_name(self, dict_id):
        self._ensure_connection()
        with self.conn.cursor() as cur:
            cur.execute("SELECT name FROM bot_dictionaries WHERE id=%s", (dict_id,))
            row = cur.fetchone()
            return row[0] if row else "Noma'lum"
