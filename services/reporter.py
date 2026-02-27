import os
import smtplib
from email.mime.text import MIMEText
from datetime import date
from database import Database

async def send_daily_email_report(db: Database):
    stats = db.get_admin_stats()
    top_users = db.get_top_active_users(3)
    
    today = date.today().strftime("%d.%m.%Y")
    subject = f"📈 LessonLab Daily Stats - {today}"
    
    body = (
        f"📊 LessonLab Bot Statistikasi ({today})\n\n"
        f"👥 Jami foydalanuvchilar: {stats['total_users']}\n"
        f"🔥 Bugun faol bo'lganlar: {stats['active_today']}\n"
        f"✅ Bugun yechilgan testlar: {stats['tests_today']}\n\n"
        "🏆 Top 3 faol foydalanuvchi:\n"
    )
    
    for i, (name, count) in enumerate(top_users, 1):
        body += f"{i}. {name}: {count} ta test\n"
    
    sender = os.getenv("REPORT_EMAIL_SENDER")
    password = os.getenv("REPORT_EMAIL_PASS")
    receiver = os.getenv("REPORT_EMAIL_RECEIVER")
    
    if not all([sender, password, receiver]):
        print("[REPORTER] Email settings missing in .env")
        return

    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = receiver
    
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(sender, password)
            server.send_message(msg)
        print(f"[REPORTER] Daily email report sent to {receiver}")
    except Exception as e:
        print(f"[REPORTER] Email error: {e}")
