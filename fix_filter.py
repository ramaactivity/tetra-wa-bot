
import json
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import os

token_path = os.path.expanduser('~/.hermes/google_token.json')
creds = Credentials.from_authorized_user_file(token_path)
service = build('sheets', 'v4', credentials=creds)
ssid = '1T-WqMq97zEEkggMLts6ZcyLB4w3PXlx85t5scnruFdE'

# Fix formulas referencing 'Database' tab instead of 'Sheet1'
filter_section = [
    ["", "", "PILIH BULAN / TAHUN", "TOTAL LEADS"],
    ["", "", "Juli 2026", '=COUNTIF(Database!F:F, "*2026-07*")'],
    ["", "", "Agustus 2026", '=COUNTIF(Database!F:F, "*2026-08*")'],
    ["", "", "September 2026", '=COUNTIF(Database!F:F, "*2026-09*")'],
]

body = {'values': filter_section}
service.spreadsheets().values().update(
    spreadsheetId=ssid, range='Statistik!C1:F5',
    valueInputOption='USER_ENTERED', body=body).execute()
print("Fixed filter formulas to reference 'Database' tab.")
