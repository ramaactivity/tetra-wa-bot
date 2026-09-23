# Append 1 baris lead ter-enrich ke tab Database Google Sheet.
# Dipanggil sheetSync.js via subprocess. Baca baris dari /tmp/tetra_sheet_row.json
# (JSON array-of-array), lalu append ke Database!A:M (RAW, biar konsisten dgn backfill).
import json, os, sys
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SSID = '1T-WqMq97zEEkggMLts6ZcyLB4w3PXlx85t5scnruFdE'
PATH = '/tmp/tetra_sheet_row.json'

try:
    rows = json.load(open(PATH))
except Exception as e:
    print('[sheet_append] gagal baca', PATH, e, file=sys.stderr)
    sys.exit(1)

creds = Credentials.from_authorized_user_file(os.path.expanduser('~/.hermes/google_token.json'))
svc = build('sheets', 'v4', credentials=creds)
res = svc.spreadsheets().values().append(
    spreadsheetId=SSID, range='Database!A:M',
    valueInputOption='RAW', insertDataOption='INSERT_ROWS',
    body={'values': rows}).execute()
print('appended', res.get('updates', {}).get('updatedRows', 0), 'rows')
