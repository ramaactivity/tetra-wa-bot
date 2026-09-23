
import json
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import os

token_path = os.path.expanduser('~/.hermes/google_token.json')
creds = Credentials.from_authorized_user_file(token_path)
service = build('sheets', 'v4', credentials=creds)

ssid = '1T-WqMq97zEEkggMLts6ZcyLB4w3PXlx85t5scnruFdE'

# Check if 'Statistik' tab exists, if not create it
sheet_metadata = service.spreadsheets().get(spreadsheetId=ssid).execute()
sheets = sheet_metadata.get('sheets', '')
exists = any(s.get('properties', {}).get('title') == 'Statistik' for s in sheets)

if not exists:
    body = {
        'requests': [{
            'addSheet': {
                'properties': {
                    'title': 'Statistik'
                }
            }
        }]
    }
    service.spreadsheets().batchUpdate(spreadsheetId=ssid, body=body).execute()
    print("Created 'Statistik' sheet tab.")
else:
    print("'Statistik' tab already exists.")

# Populate Statistik summary data
summary_data = [
    ["METRIK STATISTIK & RINGKASAN LEADS TETRA", ""],
    ["Total Leads Keseluruhan", "430"],
    ["", ""],
    ["TOP KATEGORI ACARA", "JUMLAH"],
    ["Wedding / Pernikahan", "113"],
    ["Gathering / Outing", "8"],
    ["Acara Kampus", "6"],
    ["Acara Sekolah", "5"],
    ["Corporate", "5"],
    ["", ""],
    ["TOP LOKASI VENUE", "JUMLAH"],
    ["Bogor", "62"],
    ["Jakarta", "13"],
    ["Depok", "9"],
    ["Sentul", "4"],
    ["Bekasi", "2"],
    ["", ""],
    ["BULAN / TAHUN", "JUMLAH LEADS"],
    ["Juni 2026", "35"],
    ["Juli 2026", "150"],
    ["Agustus 2026", "120"],
    ["September 2026", "125"]
]

body = {
    'values': summary_data
}
service.spreadsheets().values().update(
    spreadsheetId=ssid, range='Statistik!A1:B22',
    valueInputOption='RAW', body=body).execute()
print("Populated Statistik tab with summary data.")
