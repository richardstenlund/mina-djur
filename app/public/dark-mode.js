(() => {
	const STORAGE_KEY = 'mina-djur-theme';

	function wireThemeToggle(buttonId) {
		const button = document.getElementById(buttonId);
		if (!button) return;

		function updateLabel(theme) {
			button.textContent = theme === 'dark' ? '☀️ Ljust läge' : '🌙 Mörkt läge';
			button.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
		}

		updateLabel(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
		button.addEventListener('click', () => {
			const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
			document.documentElement.dataset.theme = next;
			try { localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
			updateLabel(next);
		});
	}

	window.MinaDjurTheme = { wireThemeToggle };
})();
