from pathlib import Path
import sys

app = Path('src/App.jsx')
if not app.exists():
    sys.exit('ERROR: Run this script in the proof-of-contribution project root (where src/App.jsx exists).')
s = app.read_text(encoding='utf-8')
if 'POC_DEMO_PREVIEW_V1' in s:
    sys.exit('Demo Preview is already installed; no changes made.')

sample_marker = 'const menus = ['
samples = '''// POC_DEMO_PREVIEW_V1: illustrative records; never inserted into localStorage or published.
const DEMO_RECORDS = [
  { id: 'demo-education', title: 'Portaldot V3 Beginner Guide', category: 'Education', status: 'Approved', createdAt: '2026-10-21T10:00:00.000Z', demo: true },
  { id: 'demo-dev', title: 'Open-source Wallet Tutorial', category: 'Development', status: 'Approved', createdAt: '2026-10-20T10:00:00.000Z', demo: true },
  { id: 'demo-translation', title: 'Community Documentation Translation', category: 'Community', status: 'Pending Review', createdAt: '2026-10-19T10:00:00.000Z', demo: true },
  { id: 'demo-content', title: 'Ecosystem Research Thread', category: 'Content', status: 'Rejected', createdAt: '2026-10-18T10:00:00.000Z', demo: true }
]
'''
if s.count(sample_marker) != 1:
    sys.exit('ERROR: Unexpected App.jsx structure (menus). No changes made.')
s = s.replace(sample_marker, samples + sample_marker, 1)

state_marker = "  const [notice, setNotice] = useState('')"
if s.count(state_marker) != 1:
    sys.exit('ERROR: Unexpected App.jsx structure (notice state). No changes made.')
s = s.replace(state_marker, state_marker + "\n  const [demoMode, setDemoMode] = useState(true) // Only affects Overview presentation", 1)

needle = "  const published = mine.filter(item => !!storedProofs[item.id])"
if s.count(needle) != 1:
    sys.exit('ERROR: Unexpected App.jsx structure (published stats). No changes made.')
s = s.replace(needle, needle + "\n  const overviewRecords = demoMode ? DEMO_RECORDS : mine\n  const overviewPending = demoMode ? 1 : pending.length\n  const overviewApproved = demoMode ? 2 : approved.length", 1)

start = s.find("           {page === 'overview' && <>")
end = s.find("           {page === 'submit' && <>", start)
if start == -1 or end == -1:
    sys.exit('ERROR: Unexpected App.jsx structure (Overview section). No changes made.')
block = s[start:end]
old_stats = "[{label:'My contributions',num:mine.length,icon:FileCheck2},{label:'Approved locally',num:approved.length,icon:CheckCircle2},{label:'On-chain proofs',num:published.length,icon:Fingerprint},{label:'Pending review',num:pending.length,icon:Activity}]"
new_stats = "[{label:demoMode ? 'Demo contributions' : 'My contributions',num:overviewRecords.length,icon:FileCheck2},{label:demoMode ? 'Demo approved' : 'Approved locally',num:overviewApproved,icon:CheckCircle2},{label:demoMode ? 'Verified testnet example' : 'My on-chain proofs',num:demoMode ? 1 : published.length,icon:Fingerprint},{label:demoMode ? 'Demo pending' : 'Pending review',num:overviewPending,icon:Activity}]"
if block.count(old_stats) != 1:
    sys.exit('ERROR: Unexpected Overview statistics structure. No changes made.')
block = block.replace(old_stats, new_stats)
block = block.replace('<small>Current browser / connected wallet</small>', "<small>{demoMode ? 'Illustrative data (not on-chain)' : 'Current browser / connected wallet'}</small>")
block = block.replace("{!account ? <div className=\"ui-empty\">", "{!account && !demoMode ? <div className=\"ui-empty\">", 1)
block = block.replace("mine.length === 0 ? <div className=\"ui-empty\">", "overviewRecords.length === 0 ? <div className=\"ui-empty\">", 1)
block = block.replace("{mine.slice(0,5).map(item =>", "{overviewRecords.slice(0,5).map(item =>", 1)

anchor = '<div className="ui-stats">'
control = '''<div className="ui-info" style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
              <span><strong>{demoMode ? 'DEMO PREVIEW' : 'YOUR DATA'}</strong> — {demoMode ? 'Sample contribution records for presentation only. The single verified testnet example is real; other demo counts are illustrative.' : 'Showing records stored in this browser for your connected wallet.'}</span>
              <button type="button" className="ui-btn ui-outline" onClick={() => setDemoMode(value => !value)}>{demoMode ? 'Show my real data' : 'Show demo preview'}</button>
            </div>
            ''' + anchor
if block.count(anchor) != 1:
    sys.exit('ERROR: Unexpected Overview stats container. No changes made.')
block = block.replace(anchor,control,1)
s = s[:start] + block + s[end:]
backup = app.with_suffix('.jsx.before-demo.bak')
if not backup.exists():
    backup.write_text(app.read_text(encoding='utf-8'), encoding='utf-8')
app.write_text(s, encoding='utf-8')
print('SUCCESS: Demo Preview added to Overview in src/App.jsx')
print('Backup:', backup)
print('Review at npm run dev, then: git add src/App.jsx && git commit -m "feat: add clearly labeled dashboard demo preview" && git push origin main')
