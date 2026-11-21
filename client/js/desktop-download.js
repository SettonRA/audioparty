// Shows the "Download Desktop App" button when the server has a download to offer
// (see DESKTOP_DOWNLOAD_FILE / DESKTOP_DOWNLOAD_URL in the server's .env).
(function () {
  const button = document.getElementById('desktop-download-btn');
  if (!button) return;

  fetch('/api/desktop-download')
    .then(res => res.json())
    .then(info => {
      if (!info || !info.available) return;

      button.href = info.url;
      if (info.filename) button.setAttribute('download', info.filename);

      let label = '(Windows)';
      if (info.size) {
        const megabytes = info.size / (1024 * 1024);
        label += ' ' + megabytes.toFixed(megabytes < 10 ? 1 : 0) + ' MB';
      }
      document.getElementById('desktop-download-size').textContent = label;

      button.classList.remove('hidden');

      // The desktop app details live in the "Trouble Connecting?" panel
      const help = document.getElementById('desktop-help');
      if (help) help.classList.remove('hidden');
    })
    .catch(() => { /* no download offered: leave everything hidden */ });
})();
