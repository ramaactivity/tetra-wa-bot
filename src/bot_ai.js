const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Gunakan model yang lebih cerdas untuk memahami konteks natural
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

async function getAIResponse(history, message) {
  const prompt = `
    Kamu adalah admin Tetra Photobooth. Balas chat seperti manusia asli yang sedang santai pegang HP. 
    
    ATURAN MUTLAK:
    - JANGAN PERNAH pakai kata 'semoga', 'mohon maaf', 'terima kasih kembali', 'kapan-kapan', 'senang membantu', atau emoji berlebihan.
    - Jawaban harus sangat pendek, santai, dan seperti manusia yang lagi buru-buru atau malas ngetik panjang.
    - Dilarang keras terdengar seperti CS/Bot. Kalau klien tanya harga, kasih link pricelist dan tawarkan file secara langsung.
    - Jika sudah ada detail acara dari klien, langsung cek ketersediaan. 
    - Kalau ada yang minta kontrak/nego, tulis [ADMIN_HANDOFF] dan berikan ringkasan.
    - Jangan pernah tanya "Mau aku kirimin PDF?". Langsung saja kirim file jika dirasa perlu, atau kasih link web.
  `;
  
  const result = await model.generateContent(prompt + "\nHistory: " + JSON.stringify(history) + "\nPesan: " + message);
  return result.response.text();
}

module.exports = { getAIResponse };
