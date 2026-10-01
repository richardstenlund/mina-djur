(() => {
	const notice = document.querySelector('#notice');
	const list = document.querySelector('#userList');
	const emptyState = document.querySelector('#emptyState');

	function showNotice(message) {
		notice.textContent = message;
		notice.classList.add('visible');
	}

	async function api(path) {
		const response = await fetch(path, { headers: { 'Content-Type': 'application/json' } });
		if (response.status === 401) {
			window.location.href = '/login.html';
			throw new Error('Inte inloggad.');
		}
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || 'Något gick fel.');
		}
		return response.json();
	}

	function element(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function plural(count, singular, plural) {
		return count === 1 ? singular : plural;
	}

	function makeUserCard(user) {
		const card = element('article', 'user-card');
		card.append(element('span', 'user-avatar', '🧑'));
		const info = element('div', 'user-info');
		info.append(element('h3', 'user-name', user.username));
		const badges = element('div', 'user-badges');
		if (user.sharedByMe > 0) {
			badges.append(element('span', 'reminder-badge ok', `Du delar ${user.sharedByMe} ${plural(user.sharedByMe, 'djur', 'djur')} med personen`));
		}
		if (user.sharedWithMe > 0) {
			badges.append(element('span', 'shared-badge', `Delar ${user.sharedWithMe} ${plural(user.sharedWithMe, 'djur', 'djur')} med dig`));
		}
		if (!user.sharedByMe && !user.sharedWithMe) {
			badges.append(element('span', 'field-hint', 'Ingen delning ännu'));
		}
		info.append(badges);
		card.append(info);
		const actions = element('div', 'card-actions');
		const viewAnimals = document.createElement('a');
		viewAnimals.className = 'text-button';
		viewAnimals.href = `/user-animals.html?id=${encodeURIComponent(user.id)}`;
		viewAnimals.textContent = 'Visa djur';
		actions.append(viewAnimals);
		card.append(actions);
		return card;
	}

	async function init() {
		try {
			const me = await api('/api/auth/me');
			document.querySelector('#usernameLabel').textContent = me.username;
		} catch {
			return;
		}
		try {
			const users = await api('/api/users');
			list.replaceChildren();
			emptyState.classList.toggle('hidden', users.length > 0);
			users.forEach(user => list.append(makeUserCard(user)));
		} catch (error) {
			showNotice(error.message || 'Kunde inte hämta användarna just nu.');
		}
	}

	document.querySelector('#logoutButton').addEventListener('click', async () => {
		try {
			await fetch('/api/auth/logout', { method: 'POST' });
		} finally {
			window.location.href = '/login.html';
		}
	});

	if (window.MinaDjurTheme) window.MinaDjurTheme.wireThemeToggle('themeToggle');

	init();
})();
