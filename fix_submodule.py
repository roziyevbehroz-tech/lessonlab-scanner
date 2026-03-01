import os

print("="*50)
print("🛠 GitHub Submodule muammosini butunlay tozalash...")
print("="*50)

# 1. Eski .gitmodules keshlarini tozalash
print("1. Keshdan submodule qoldiqlarini o'chiryapmiz...")
os.system("git rm --cached templates/lessonlab-scanner -f")
os.system("git rm .gitmodules -f")

# 2. .git/modules papkasini ichidan ham o'chirish
os.system(r"rmdir /s /q .git\modules\templates\lessonlab-scanner 2>nul")

# 3. Yana bir bor qo'shish va commit qilib push qilish
print("2. O'zgarishlarni Gitga qo'shyapmiz (faqat barcha tozalashlarni)...")
os.system("git add -A")
os.system('git commit -m "Clean up broken submodule reference entirely"')
os.system("git push origin main")

print("="*50)
print("✅ Bajarildi! Submodule qoldiqlari olib tashlandi. Endi GitHub Actions ishga tushishi kerak.")
