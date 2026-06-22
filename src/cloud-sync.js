// Cloud sync without API keys: store the data file inside the user's existing
// OneDrive / Google Drive folder so their desktop sync client mirrors it across
// devices. We detect common install locations; the user can also pick a folder.
const fs = require('fs');
const path = require('path');
const os = require('os');

function firstExisting(paths) {
  for (const p of paths) {
    try { if (p && fs.existsSync(p)) return p; } catch {}
  }
  return null;
}

function detect() {
  const home = os.homedir();
  const onedrive = firstExisting([
    process.env.OneDrive,
    process.env.OneDriveConsumer,
    process.env.OneDriveCommercial,
    path.join(home, 'OneDrive')
  ]);

  // Google Drive: classic "Google Drive" folder, the newer "My Drive", or a
  // mounted Drive virtual drive (commonly G:, but scan A–Z for "My Drive").
  const gdriveCandidates = [
    path.join(home, 'Google Drive'),
    path.join(home, 'My Drive'),
    process.env.GOOGLE_DRIVE
  ];
  for (let c = 67 /* C */; c <= 90 /* Z */; c++) {
    const letter = String.fromCharCode(c);
    gdriveCandidates.push(`${letter}:\\My Drive`);
  }
  const gdrive = firstExisting(gdriveCandidates);

  return { onedrive, gdrive };
}

// Resolve the absolute data-file path for a given sync configuration.
function resolveFile(provider, folder) {
  const detected = detect();
  let base = null;
  if (provider === 'onedrive') base = detected.onedrive;
  else if (provider === 'gdrive') base = detected.gdrive;
  else if (provider === 'custom') base = folder;
  if (!base) return null;
  return path.join(base, 'DesktopCalendar', 'deskcal-data.json');
}

module.exports = { detect, resolveFile };
