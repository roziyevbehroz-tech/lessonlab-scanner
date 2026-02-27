import asyncio
from aiogram import Bot
from aiogram.types import MenuButtonWebApp, WebAppInfo

TOKEN = "8145781782:AAFfD5AE78OGA74-U0YmJGu3l9AqGcIGIKQ"

async def main():
    bot = Bot(token=TOKEN)
    try:
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(
                text="L-Lab App",
                web_app=WebAppInfo(url="https://roziyevbehroz-tech.github.io/lessonlab-scanner/miniapp/index.html?v=1.1")
            )
        )
        print("Successfully set chat menu button.")
    except Exception as e:
        print(f"Error: {e}")
    finally:
        await bot.session.close()

if __name__ == "__main__":
    asyncio.run(main())
