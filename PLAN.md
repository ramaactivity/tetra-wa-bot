# PLAN: Tetra WA Bot Evolution — AI Agent Implementation

## Objective
Upgrade `tetra-wa-bot` from rule-based template to AI Agent using Gemini 2.0 Flash with "Admin-Style" persona and dynamic lead follow-up.

## Execution Steps

### 1. Persona Implementation (System Prompt)
- Update `src/bot.js` logic to wrap every user message in an AI prompt.
- **System Prompt:**
  "Kamu admin Tetra Photobooth. Gaya bicara: santai, lugas, anti-basa-basi (no 'semoga hari anda menyenangkan', dll). 
  Jika ditanya harga: berikan harga + info urgensi slot. 
  Jika ditanya DP/lokasi/booking: jawab dengan fakta, lalu dorong ke booking.
  Jika ditanya negosiasi/kontrak/serius: berhenti menjawab, ketik '[ADMIN_HANDOFF]' dan berikan ringkasan chat.
  Jangan pakai emoji berlebihan. Natural seperti manusia asli."

### 2. AI Agent Core (Gemini 2.0 Flash)
- Install `@google/generative-ai` to replace static `config.js` logic with AI inference.
- Implement `getAIResponse(history, message)` function using Gemini 2.0 Flash.

### 3. State Management (Context Memory)
- Use Supabase `whatsapp_bot_leads` as the short-term memory source.
- Function to fetch last 3-5 messages of a JID to keep the chat natural.

### 4. Integration
- Add "Sales Closer" logic: auto-check for `followup` needs (trigger on timeout).
- Connect Telegram admin notification for "Admin Hand-off".

## Verification
- Run dry-run mode (log answers to console without sending).
- Verify "Zona Merah" handoff trigger.
- Check "Admin Persona" tone against audit data.
