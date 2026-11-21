// Shows the "Windows desktop app" download card when the server has a download to offer
// (see DESKTOP_DOWNLOAD_FILE / DESKTOP_DOWNLOAD_URL in the server's .env).
(function () {
  const card = document.getElementById('desktop-download');
  if (!card) return;

  fetch('/api/desktop-download')
    .then(res => res.json())
    .then(info => {
      if (!info || !info.available) return;

      const button = document.getElementById('desktop-download-btn');
      button.href = info.url;
      if (info.filename) button.setAttribute('download', info.filename);

      if (info.size) {
        const megabytes = info.size / (1024 * 1024);
        document.getElementById('desktop-download-size').textContent = megabytes.toFixed(megabytes < 10 ? 1 : 0) + ' MB';
      }

      card.classList.remove('hidden');
    })
    .catch(() => { /* no download offered: leave the card hidden */ });
})();
