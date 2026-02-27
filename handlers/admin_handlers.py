import os
from aiogram import Router, F, types
from aiogram.filters import Command
from database import Database

router = Router()
db = Database()

@router.message(Command("stats"))
async def admin_stats_command(message: types.Message):
    admin_id = int(os.getenv("ADMIN_ID", 0))
    
    if message.from_user.id != admin_id:
        return

    stats = db.get_admin_stats()
    
    total_users = stats['total_users']
    active_today = stats['active_today']
    tests_today = stats['tests_today']
    
    stats_text = (
        "📊 <b>Bot Statistikasi (Jonli)</b>\n\n"
        f"👥 Jami foydalanuvchilar: {total_users}\n"
        f"🔥 Bugun faol bo'lganlar: {active_today}\n"
        f"✅ Bugun yechilgan testlar: {tests_today}\n"
    )
    await message.answer(stats_text, parse_mode="HTML")
