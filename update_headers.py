
import json
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import os

token_path = os.path.expanduser('~/.hermes/google_token.json')
creds = Credentials.from_authorized_user_file(token_path)
service = build('sheets', 'v4', credentials=creds)

ssid = '1T-WqMq97zEEkggMLts6ZcyLB4w3PXlx85t5scnruFdE'
headers = [["ID WhatsApp", "Nomor Telepon", "Nama", "Topik", "Pesan", "Waktu Masuk", "Status Follow-up", "Tanggal Acara", "Lokasi Venue", "Alasan / Catatan"]]

body = {
    'values': headers
}
result = service.spreadsheets().values().update(
    spreadsheetId=ssid, range='Sheet1!A1:J1',
    valueInputOption='RAW', body=body).execute()
print("Updated headers:", result.get('updatedCells'))
