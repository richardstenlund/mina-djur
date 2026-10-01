(() => {
	const typeIcons = {
		Katt: '🐈', Hund: '🐕', Kanin: '🐇', Marsvin: '🐹', Hamster: '🐹',
		Råtta: '🐭', Mus: '🐭', Gerbil: '🐭', Chinchilla: '🐭', Degu: '🐭',
		Iller: '🦦', Igelkott: '🦔', Fågel: '🐦', Sköldpadda: '🐢', Ödla: '🦎',
		Orm: '🐍', Fisk: '🐟'
	};
	const notice = document.querySelector('#notice');
	const groupsContainer = document.querySelector('#sharedGroups');
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

	function formatDate(date) {
		if (!date) return '';
		const parsed = new Date(`${date}T00:00:00`);
		return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('sv-SE').format(parsed);
	}

	function latestRecord(animal, type) {
		return (animal.records || []).filter(record => record.type === type).sort((a, b) => b.date.localeCompare(a.date))[0];
	}

	function getWeight(animal) {
		const latest = latestRecord(animal, 'Vikt');
		return latest && latest.weight ? latest.weight : animal.initialWeight;
	}

	function getAnimalExampleImage(type) {
		return Object.prototype.hasOwnProperty.call(window.animalExampleImages || {}, type)
			? window.animalExampleImages[type]
			: null;
	}

	function makeAnimalCard(animal) {
		const card = element('article', 'animal-card');
		const main = element('div', 'animal-main');
		const identity = element('div', 'animal-identity');
		if (animal.coverPhotoUrl) {
			const cover = document.createElement('img');
			cover.className = 'animal-cover';
			cover.src = animal.coverPhotoUrl;
			cover.alt = `Foto på ${animal.name}`;
			identity.append(cover);
		} else {
			const exampleImage = getAnimalExampleImage(animal.type);
			if (exampleImage) {
				const illustration = document.createElement('img');
				illustration.className = 'animal-cover';
				illustration.src = exampleImage;
				illustration.alt = `Exempelillustration av ${animal.type.toLocaleLowerCase('sv-SE')}`;
				identity.append(illustration);
			} else {
				identity.append(element('span', 'animal-icon', typeIcons[animal.type] || '🐾'));
			}
		}
		const text = element('div');
		text.append(element('h3', 'animal-name', animal.name), element('span', 'animal-type', animal.breed ? `${animal.type} · ${animal.breed}` : animal.type));

		const meta = element('div', 'animal-meta');
		if (animal.sex) meta.append(element('span', '', `${animal.sex === 'Hona' ? '♀' : '♂'} ${animal.sex}`));
		if (animal.neutered) meta.append(element('span', '', '🔒 Kastrerad'));
		if (animal.birthday) meta.append(element('span', '', `🎂 ${formatDate(animal.birthday)}`));
		const weight = getWeight(animal);
		if (weight) meta.append(element('span', '', `⚖️ ${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(weight)} kg`));
		const claws = latestRecord(animal, 'Kloklippning');
		if (claws) meta.append(element('span', '', `✂️ Kloklippning ${formatDate(claws.date)}`));
		if (!animal.birthday && !weight && !claws) meta.append(element('span', '', 'Ingen skötselhistorik ännu'));
		text.append(meta);

		const reminders = (animal.reminders || []).filter(reminder => reminder.status === 'försenad' || reminder.status === 'snart');
		if (reminders.length) {
			const badges = element('div', 'reminder-badges');
			reminders.forEach(reminder => {
				const label = reminder.status === 'försenad'
					? `⏰ ${reminder.type} försenad`
					: `⏰ ${reminder.type} om ${reminder.daysUntil} ${reminder.daysUntil === 1 ? 'dag' : 'dagar'}`;
				badges.append(element('span', `reminder-badge ${reminder.status === 'försenad' ? 'overdue' : 'soon'}`, label));
			});
			text.append(badges);
		}
		if (animal.info) text.append(element('p', 'animal-info', animal.info));
		identity.append(text);
		main.append(identity);
		card.append(main);

		const actions = element('div', 'card-actions');
		const openProfile = document.createElement('a');
		openProfile.className = 'text-button';
		openProfile.href = `/animal.html?id=${encodeURIComponent(animal.id)}`;
		openProfile.textContent = 'Öppna profil';
		actions.append(openProfile);
		const history = animal.records ? animal.records.length : 0;
		actions.append(element('span', 'field-hint', `Skötsel & historik (${history})`));
		card.append(actions);

		return card;
	}

	function render(animals) {
		groupsContainer.replaceChildren();
		const sharedAnimals = animals.filter(animal => animal.isOwner === false);
		emptyState.classList.toggle('hidden', sharedAnimals.length > 0);
		if (!sharedAnimals.length) return;

		const byOwner = new Map();
		sharedAnimals.forEach(animal => {
			const owner = animal.ownerUsername || 'Okänd användare';
			const list = byOwner.get(owner) || [];
			list.push(animal);
			byOwner.set(owner, list);
		});

		[...byOwner.keys()].sort((a, b) => a.localeCompare(b, 'sv-SE')).forEach(owner => {
			const group = element('section', 'shared-group');
			group.append(element('h2', 'shared-group-title', `Delat av ${owner}`));
			const grid = element('div', 'animal-list');
			byOwner.get(owner).forEach(animal => grid.append(makeAnimalCard(animal)));
			group.append(grid);
			groupsContainer.append(group);
		});
	}

	async function init() {
		try {
			const me = await api('/api/auth/me');
			document.querySelector('#usernameLabel').textContent = me.username;
		} catch {
			return;
		}
		try {
			const animals = await api('/api/animals');
			render(animals);
		} catch (error) {
			showNotice(error.message || 'Kunde inte hämta delade djur just nu.');
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
