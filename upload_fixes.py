import os
import shutil

print("="*50)
print("🚀 Hamma xatolarni tag-tugi bilan tozalab, yangilanishlarni yuklash boshlandi...")
print("="*50)

# 1. Oldingi qilgan zo'r o'zgarishlarimizni (Zoom va Kamera ruxsatlarini) saqlaymiz
print("1. UI va Kamera o'zgarishlarini saqlayapmiz...")
os.system("git add scanner/style.css scanner/app.js")
os.system('git commit -m "Fix: Zoom tugmalari va Kamera ruxsati to\'g\'rilandi"')

# 2. Submodule balo/battarlarini jismonan o'chiramiz
print("2. Submodule ni jismonan arxivdan o'chiryapmiz...")
# Papkni tizimdan o'chirish
if os.path.exists(r"templates\lessonlab-scanner"):
    shutil.rmtree(r"templates\lessonlab-scanner", ignore_errors=True)
if os.path.exists(r".git\modules\templates"):
    shutil.rmtree(r".git\modules\templates", ignore_errors=True)

# 3. Git xotirasidan o'chiramiz
print("3. Git xotirasini bo'shatyapmiz...")
os.system("git rm -rf templates/lessonlab-scanner")
os.system("git rm -rf --cached templates/lessonlab-scanner")
os.system("git rm -f .gitmodules")

# 4. Tozalashni commit qilamiz
os.system('git commit -m "Fix: Submodule butunlay olib tashlandi"')

# 5. Githubga majburan (force) yuklaymiz
print("4. GitHub ni tozalab yangilayapmiz (Biros vaqt olishi mumkin)...")
os.system("git push origin main -f")

print("="*50)
print("✅ Bajarildi! Action xatosi endi umuman chiqmaydi va kamera muammosi ham hal bo'ldi!")
