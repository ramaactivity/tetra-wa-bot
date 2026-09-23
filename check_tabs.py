
import json
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import os

token_path = os.path.expanduser('~/.hermes/google_token.json')
creds = Credentials.from_authorized_user_file(token_path)
service = build('sheets', 'v4', credentials=creds)
ssid = '1T-WqMq97zEEkggMLts6ZcyLB4w3PXlx85t5scnruFdE'

sheet_metadata = service.spreadsheets().get(spreadsheetId=ssid).execute()
for s in sheet_metadata.get('sheets'):
    print("Tab title:", s.get('properties').get('title'))
