#!/usr/bin/env python3
# Bangun Google Sheet "Tetra Leads History" dari /tmp/tetra_sync.json.
# 4 tab: Database (raw), Bulanan (agregat long-format), Statistik (dashboard),
# Config (daftar periode untuk dropdown). Dipanggil oleh sync_sheet.js.
import json, os, sys
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SSID = '1T-WqMq97zEEkggMLts6ZcyLB4w3PXlx85t5scnruFdE'
# Mode --refresh: hanya update Bulanan + Config (buat cron). Jangan sentuh
# Database (biar edit manual admin + append live tetap utuh) dan jangan sentuh
# Statistik (biar pilihan dropdown admin tidak ke-reset).
REFRESH = '--refresh' in sys.argv

# ── warna ────────────────────────────────────────────────────────────────────
def rgb(h):
    h = h.lstrip('#')
    return {'red': int(h[0:2], 16)/255, 'green': int(h[2:4], 16)/255, 'blue': int(h[4:6], 16)/255}

DARK    = rgb('#1F2937')  # header tabel
BANNER  = rgb('#1E3A5F')  # banner judul
BLUE    = rgb('#2563EB')  # judul section
BLUE_LT = rgb('#DBEAFE')  # header tabel section
KPI_LBL = rgb('#6B7280')
KPI_VAL = rgb('#0B1220')
CS_MIN  = rgb('#EFF6FF')
CS_MAX  = rgb('#2563EB')
WHITE   = rgb('#FFFFFF')
BORDER  = rgb('#E5E7EB')

creds = Credentials.from_authorized_user_file(os.path.expanduser('~/.hermes/google_token.json'))
svc = build('sheets', 'v4', credentials=creds)
sheets = svc.spreadsheets()

with open('/tmp/tetra_sync.json') as f:
    payload = json.load(f)

db_rows = payload['database']
bulanan = payload['bulanan']
months  = payload['months']

# ── pastikan tab ada & urut: Database, Bulanan, Statistik, Config ────────────
meta = sheets.get(spreadsheetId=SSID).execute()
existing = {s['properties']['title']: s['properties']['sheetId'] for s in meta['sheets']}
WANTED = ['Database', 'Bulanan', 'Statistik', 'Config']
reqs = []
for title in WANTED:
    if title not in existing:
        reqs.append({'addSheet': {'properties': {'title': title}}})
if reqs:
    sheets.batchUpdate(spreadsheetId=SSID, body={'requests': reqs}).execute()
    meta = sheets.get(spreadsheetId=SSID).execute()
    existing = {s['properties']['title']: s['properties']['sheetId'] for s in meta['sheets']}

# urutkan posisi tab
order_reqs = []
for i, title in enumerate(WANTED):
    sid = existing[title]
    order_reqs.append({'updateSheetProperties': {
        'properties': {'sheetId': sid, 'index': i},
        'fields': 'index',
    }})
sheets.batchUpdate(spreadsheetId=SSID, body={'requests': order_reqs}).execute()

# ── 1. Database ──────────────────────────────────────────────────────────────
DB_HEADER = ['Tanggal', 'Waktu', 'Nama', 'Nomor', 'Topik', 'Segmen',
             'Jenis Acara', 'Lokasi', 'Tanggal Acara', 'Pesan', 'Tahun', 'Bulan', 'Periode']
db_values = [DB_HEADER] + db_rows
if not REFRESH:
    sheets.values().clear(spreadsheetId=SSID, range='Database!A:Z').execute()
    sheets.values().update(spreadsheetId=SSID, range='Database!A1',
                           valueInputOption='RAW', body={'values': db_values}).execute()

# ── 2. Bulanan ───────────────────────────────────────────────────────────────
BL_HEADER = ['Tahun', 'Bulan', 'Periode', 'Dimensi', 'Nilai', 'Jumlah']
bl_values = [BL_HEADER] + bulanan
sheets.values().clear(spreadsheetId=SSID, range='Bulanan!A:Z').execute()
sheets.values().update(spreadsheetId=SSID, range='Bulanan!A1',
                       valueInputOption='RAW', body={'values': bl_values}).execute()

# ── 3. Config ────────────────────────────────────────────────────────────────
cfg_values = [['Periode (untuk dropdown)'], ['SEMUA PERIODE']] + [[m] for m in months]
sheets.values().clear(spreadsheetId=SSID, range='Config!A:Z').execute()
sheets.values().update(spreadsheetId=SSID, range='Config!A1',
                       valueInputOption='RAW', body={'values': cfg_values}).execute()

# ── 4. Statistik (formula) ───────────────────────────────────────────────────
def period_expr():
    return 'IF($B$3="SEMUA PERIODE","1=1","C=\'"&$B$3&"\'")'

def breakdown_query(dim, label):
    p1 = "select E, sum(F) where D='%s' and " % dim
    p2 = " group by E order by sum(F) desc label E '%s', sum(F) 'Jumlah'" % label
    return '=QUERY(Bulanan!$A$2:$F,"' + p1 + '"&' + period_expr() + '&"' + p2 + '",0)'

KPI_TOTAL = ('=IF($B$3="SEMUA PERIODE",'
             'SUMIF(Bulanan!$D$2:$D,"Total",Bulanan!$F$2:$F),'
             'SUMIFS(Bulanan!$F$2:$F,Bulanan!$D$2:$D,"Total",Bulanan!$C$2:$C,$B$3))')
KPI_DEAL = KPI_TOTAL.replace('"Total"', '"Deal"')
KPI_KONVERSI = '=IFERROR(IF(B5=0,0,E5/B5),0)'
TREND = ('=QUERY(Bulanan!$A$2:$F,'
         '"select C, F where D=\'Total\' order by A, B",0)')

NROWS, NCOLS = 95, 8
grid = [[''] * NCOLS for _ in range(NROWS)]
def put(r, c, v):
    grid[r-1][c-1] = v

put(1, 1, '📊 DASHBOARD STATISTIK LEADS TETRA PHOTOBOOTH')
put(2, 1, 'Pilih periode di bawah — semua angka & tabel di halaman ini menyesuaikan otomatis.')
put(3, 1, 'Periode:')
put(3, 2, 'SEMUA PERIODE')  # nilai default dropdown (data validation meng-override pilihan)

put(5, 1, 'TOTAL LEADS')
put(5, 2, KPI_TOTAL)
put(5, 4, 'DEAL / CLOSING')
put(5, 5, KPI_DEAL)
put(5, 7, 'KONVERSI')
put(5, 8, KPI_KONVERSI)

put(8, 1, 'TOP TOPIK / INTENT')
put(9, 1, breakdown_query('Topik', 'Topik'))

put(22, 1, 'SEGMEN KONTAK')
put(23, 1, breakdown_query('Segmen', 'Segmen'))

put(8, 4, 'KATEGORI EVENT (JENIS ACARA)')
put(9, 4, breakdown_query('Kategori', 'Jenis Acara'))

put(39, 4, 'LOKASI EVENT (KOTA)')
put(40, 4, breakdown_query('Lokasi', 'Lokasi'))

put(8, 7, 'TREN BULANAN')
put(9, 7, TREND)

put(93, 1, 'Sumber: Supabase → Database (raw) → Bulanan (agregat). Diperbarui otomatis tiap 15 menit.')

if not REFRESH:
    sheets.values().clear(spreadsheetId=SSID, range='Statistik!A1:H100').execute()
    sheets.values().update(spreadsheetId=SSID, range='Statistik!A1:H' + str(NROWS),
                           valueInputOption='USER_ENTERED',
                           body={'values': grid}).execute()

# ── formatting ───────────────────────────────────────────────────────────────
fmt_reqs = []

def solid(sheet, rng, bg, borders=True, border_color=None):
    fmt_reqs.append({'repeatCell': {
        'range': {'sheetId': existing[sheet], 'startRowIndex': rng[0], 'endRowIndex': rng[1],
                  'startColumnIndex': rng[2], 'endColumnIndex': rng[3]},
        'cell': {'userEnteredFormat': {
            'backgroundColor': bg,
            **({'borders': {
                'top': {'style': 'SOLID', 'color': border_color or BORDER},
                'bottom': {'style': 'SOLID', 'color': border_color or BORDER},
                'left': {'style': 'SOLID', 'color': border_color or BORDER},
                'right': {'style': 'SOLID', 'color': border_color or BORDER},
            }} if borders else {}),
        }},
        'fields': 'userEnteredFormat.backgroundColor' + (',userEnteredFormat.borders' if borders else ''),
    }})

def textfmt(sheet, rng, **kw):
    # bold/size/color masuk ke textFormat; wrap/align langsung di userEnteredFormat.
    tf = {}
    ue = {}
    if 'bold' in kw: tf['bold'] = kw['bold']
    if 'size' in kw: tf['fontSize'] = kw['size']
    if 'color' in kw: tf['foregroundColor'] = kw['color']
    if 'wrap' in kw: ue['wrapStrategy'] = 'WRAP' if kw['wrap'] else 'CLIP'
    if 'align' in kw: ue['horizontalAlignment'] = kw['align']
    if tf: ue['textFormat'] = tf
    fields = ','.join('userEnteredFormat.' + k for k in ue.keys())
    if tf:
        fields += ',' + ','.join('userEnteredFormat.textFormat.' + k for k in tf.keys())
    fmt_reqs.append({'repeatCell': {
        'range': {'sheetId': existing[sheet], 'startRowIndex': rng[0], 'endRowIndex': rng[1],
                  'startColumnIndex': rng[2], 'endColumnIndex': rng[3]},
        'cell': {'userEnteredFormat': ue},
        'fields': fields,
    }})

def merge(sheet, r0, r1, c0, c1):
    fmt_reqs.append({'mergeCells': {'range': {'sheetId': existing[sheet],
        'startRowIndex': r0, 'endRowIndex': r1, 'startColumnIndex': c0, 'endColumnIndex': c1},
        'mergeType': 'MERGE_ALL'}})

def width(sheet, start, end, px):
    fmt_reqs.append({'updateDimensionProperties': {
        'range': {'sheetId': existing[sheet], 'dimension': 'COLUMNS',
                  'startIndex': start, 'endIndex': end},
        'properties': {'pixelSize': px}, 'fields': 'pixelSize'}})

def freeze(sheet, rows):
    fmt_reqs.append({'updateSheetProperties': {
        'properties': {'sheetId': existing[sheet],
                       'gridProperties': {'frozenRowCount': rows}},
        'fields': 'gridProperties.frozenRowCount'}})

def color_scale(sheet, rng):
    fmt_reqs.append({'addConditionalFormatRule': {'rule': {
        'ranges': [{'sheetId': existing[sheet],
                    'startRowIndex': rng[0], 'endRowIndex': rng[1],
                    'startColumnIndex': rng[2], 'endColumnIndex': rng[3]}],
        'gradientRule': {'minpoint': {'color': CS_MIN, 'type': 'MIN'},
                          'maxpoint': {'color': CS_MAX, 'type': 'MAX'}},
    }}})

# Database: header + freeze + kolom lebar
solid('Database', (0, 1, 0, 13), DARK)
textfmt('Database', (0, 1, 0, 13), bold=True, color=WHITE, align='CENTER')
freeze('Database', 1)
width('Database', 0, 1, 90)    # Tanggal
width('Database', 1, 2, 55)    # Waktu
width('Database', 2, 3, 130)   # Nama
width('Database', 3, 4, 120)   # Nomor
width('Database', 4, 5, 90)    # Topik
width('Database', 5, 6, 90)    # Segmen
width('Database', 6, 7, 110)   # Jenis Acara
width('Database', 7, 8, 90)    # Lokasi
width('Database', 8, 9, 95)    # Tanggal Acara
width('Database', 9, 10, 500)  # Pesan (lebar, wrap)
textfmt('Database', (1, len(db_values), 9, 10), wrap=True)
width('Database', 10, 11, 50)  # Tahun
width('Database', 11, 12, 50)  # Bulan
width('Database', 12, 13, 110) # Periode

# Bulanan
solid('Bulanan', (0, 1, 0, 6), DARK)
textfmt('Bulanan', (0, 1, 0, 6), bold=True, color=WHITE, align='CENTER')
freeze('Bulanan', 1)
width('Bulanan', 0, 1, 50); width('Bulanan', 1, 2, 50); width('Bulanan', 2, 3, 120)
width('Bulanan', 3, 4, 90); width('Bulanan', 4, 5, 160); width('Bulanan', 5, 6, 70)

# Config: sembunyikan
fmt_reqs.append({'updateSheetProperties': {
    'properties': {'sheetId': existing['Config'], 'hidden': True},
    'fields': 'hidden'}})

# Statistik: banner, KPI, section, tabel, color scale
merge('Statistik', 0, 1, 0, 8)
merge('Statistik', 1, 2, 0, 8)
solid('Statistik', (0, 1, 0, 8), BANNER)
textfmt('Statistik', (0, 1, 0, 1), bold=True, size=15, color=WHITE)
textfmt('Statistik', (1, 2, 0, 1), size=9, color=rgb('#D1D5DB'))
textfmt('Statistik', (2, 3, 0, 1), bold=True, size=11)

# KPI label + nilai
for c in (0, 3, 6):
    textfmt('Statistik', (4, 5, c, c+1), bold=True, size=10, color=KPI_LBL)
textfmt('Statistik', (4, 5, 1, 2), bold=True, size=22, color=KPI_VAL)
textfmt('Statistik', (4, 5, 4, 5), bold=True, size=22, color=KPI_VAL)
textfmt('Statistik', (4, 5, 7, 8), bold=True, size=22, color=KPI_VAL)
# Konversi → format persen
fmt_reqs.append({'repeatCell': {
    'range': {'sheetId': existing['Statistik'], 'startRowIndex': 4, 'endRowIndex': 5,
              'startColumnIndex': 7, 'endColumnIndex': 8},
    'cell': {'userEnteredFormat': {'numberFormat': {'type': 'PERCENT', 'pattern': '0.0%'}}},
    'fields': 'userEnteredFormat.numberFormat',
}})

# section title
for (r, c0, c1) in [(7, 0, 2), (21, 0, 2), (7, 3, 5), (38, 3, 5), (7, 6, 8)]:
    merge('Statistik', r, r+1, c0, c1)
    solid('Statistik', (r, r+1, c0, c1), BLUE, borders=False)
    textfmt('Statistik', (r, r+1, c0, c1), bold=True, size=11, color=WHITE, align='LEFT')

# color scale pada kolom jumlah (data mulai baris 10)
color_scale('Statistik', (10, 22, 1, 2))    # Topik Jumlah
color_scale('Statistik', (10, 39, 4, 5))    # Kategori Jumlah
color_scale('Statistik', (24, 40, 1, 2))    # Segmen Jumlah
color_scale('Statistik', (41, 90, 4, 5))    # Lokasi Jumlah
color_scale('Statistik', (10, 30, 7, 8))    # Trend Total

# border luar untuk area KPI & tabel (halus)
solid('Statistik', (4, 6, 0, 8), WHITE, borders=True)
textfmt('Statistik', (92, 93, 0, 8), size=9, color=KPI_LBL, align='LEFT')

# ── data validation dropdown di Statistik!B3 ─────────────────────────────────
fmt_reqs.append({'setDataValidation': {'range': {
    'sheetId': existing['Statistik'], 'startRowIndex': 2, 'endRowIndex': 3,
    'startColumnIndex': 1, 'endColumnIndex': 2},
    'rule': {'condition': {'type': 'ONE_OF_RANGE',
        'values': [{'userEnteredValue': '=Config!$A$2:$A$200'}]},
        'showCustomUi': True, 'strict': False}}})

# terapkan (batch 100 per request)
for i in range(0, len(fmt_reqs), 100):
    chunk = fmt_reqs[i:i+100]
    try:
        sheets.batchUpdate(spreadsheetId=SSID, body={'requests': chunk}).execute()
    except Exception as e:
        print('[build] batch formatting error:', e)

print('[build] OK — Database=%d rows, Bulanan=%d rows, months=%d'
      % (len(db_rows), len(bulanan), len(months)))
