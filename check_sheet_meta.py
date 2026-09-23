
import json
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import os

token_path = os.path.expanduser('~/.hermes/google_token.json')
creds = Credentials.from_authorized_user_file(token_path)
service = build('sheets', 'v4', credentials=creds)

ssid = '1T-WqMq97zEEkggMLts6ZcyLB4w3PXlx85t5scnruFdE'
sheet = service.spreadsheets()
result = sheet.get(spreadsheetId=ssid).execute()
print("Spreadsheet title:", result.get('properties').get('title'))
for s in result.get('sheets'):
    print("Sheet name:", s.get('properties').get('title'))
