const { app } = require('electron');
app.whenReady().then(() => {
  try {
    console.log('platform', process.platform, 'exe', process.execPath);
    app.setLoginItemSettings({ openAtLogin: true });
    console.log('SET-OK', JSON.stringify(app.getLoginItemSettings()));
    app.setLoginItemSettings({ openAtLogin: false });
    console.log('UNSET-OK', JSON.stringify(app.getLoginItemSettings()));
  } catch (e) {
    console.log('ERROR', e && e.stack);
  }
  app.quit();
});
