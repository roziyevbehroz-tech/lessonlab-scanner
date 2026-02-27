// ==========================================
// SUPABASE SOZLAMALARI
// DIQQAT: O'zingizning Supabase loyihangiz ma'lumotlarini kiritishingiz kerak.
// ==========================================

// 1. Supabase loyihangiz sozlamalaridan (Project Settings -> API) URL ni oling.
// Masalan: https://abcdefghijklm.supabase.co
const SUPABASE_URL = 'https://lxppxnawxmcfebmzdgil.supabase.co';

// 2. O'sha yerdagi "anon" (public) kalitini oling.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx4cHB4bmF3eG1jZmVibXpkZ2lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc3NjMzMTYsImV4cCI6MjA4MzMzOTMxNn0.uoYtCVIi0WGIY6tQlhK-UoGtOwe-ySi8O95uH1vASNU';

// Tizimdagi xatolikka yo'l qo'ymaslik uchun agar foydalanuvchi kirotmagan bo'lsa console xabari.
if (SUPABASE_URL.includes('YOUR_') || SUPABASE_ANON_KEY.includes('YOUR_')) {
          console.error("DIQQAT: Supabase sozlamalari kiritilmagan! Iltimos, supabaseConfig.js faylini o'zgartiring.");
}

// Supabase klientini yaratish
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
