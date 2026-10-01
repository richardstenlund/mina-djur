(() => {
	const LOG_TYPES = ['Vikt', 'Kloklippning', 'Veterinärbesök', 'Medicin', 'Vaccination', 'Avmaskning', 'Pälsvård', 'Övrigt'];
	const typeIcons = {
		Katt: '🐈', Hund: '🐕', Kanin: '🐇', Marsvin: '🐹', Hamster: '🐹',
		Råtta: '🐭', Mus: '🐭', Gerbil: '🐭', Chinchilla: '🐭', Degu: '🐭',
		Iller: '🦦', Igelkott: '🦔', Fågel: '🐦', Sköldpadda: '🐢', Ödla: '🦎',
		Orm: '🐍', Fisk: '🐟'
	};
	const notice = document.querySelector('#notice');
	const form = document.querySelector('#animalForm');
	const list = document.querySelector('#animals');
	const typeSelect = document.querySelector('#type');
	const customType = document.querySelector('#customType');
	const breedInput = document.querySelector('#breed');
	const breedOptions = document.querySelector('#breed-options');
	const saveButton = form.querySelector('button[type="submit"]');
	let animals = [];

	function updateBreedOptions(type) {
		breedOptions.replaceChildren();
		(window.animalBreedOptions[type] || []).forEach(breed => {
			const option = document.createElement('option');
			option.value = breed;
			breedOptions.append(option);
		});
	}

	function showNotice(message, variant = 'error') {
		notice.textContent = message;
		notice.classList.add('visible');
		notice.classList.toggle('success', variant === 'success');
	}

	function clearNotice() {
		notice.classList.remove('visible', 'success');
	}

	async function api(path, options = {}) {
		const response = await fetch(path, {
			...options,
			headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
		});
		if (response.status === 401) {
			window.location.href = '/login.html';
			throw new Error('Inte inloggad.');
		}
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			throw new Error(data.error || 'Något gick fel.');
		}
		if (response.status === 204) return null;
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

	function today() {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	}

	function latestRecord(animal, type) {
		return animal.records.filter(record => record.type === type).sort((a, b) => b.date.localeCompare(a.date))[0];
	}

	function getWeight(animal) {
		const latest = latestRecord(animal, 'Vikt');
		return latest && latest.weight ? latest.weight : animal.initialWeight;
	}

	function renderStats() {
		document.querySelector('#animalStat').textContent = animals.length;
		document.querySelector('#catStat').textContent = animals.filter(animal => animal.type.toLocaleLowerCase('sv-SE') === 'katt').length;
		document.querySelector('#recordStat').textContent = animals.reduce((sum, animal) => sum + animal.records.length + (animal.initialWeight ? 1 : 0), 0);
		document.querySelector('#count').textContent = animals.length === 1 ? '1 djur' : `${animals.length} djur`;
	}

	function makeLogForm(animal) {
		const logForm = element('form', 'log-form');
		logForm.dataset.animalId = animal.id;
		const typeLabel = element('label', '', 'Vad vill du anteckna?');
		typeLabel.htmlFor = `record-type-${animal.id}`;
		const recordType = element('select');
		recordType.id = typeLabel.htmlFor;
		recordType.name = 'recordType';
		LOG_TYPES.forEach(type => recordType.add(new Option(type, type)));

		const dateLabel = element('label', '', 'Datum');
		dateLabel.htmlFor = `record-date-${animal.id}`;
		const date = element('input');
		date.id = dateLabel.htmlFor;
		date.name = 'date';
		date.type = 'date';
		date.value = today();
		date.required = true;

		const weightLabel = element('label', '', 'Vikt i kg');
		weightLabel.htmlFor = `record-weight-${animal.id}`;
		const weight = element('input');
		weight.id = weightLabel.htmlFor;
		weight.name = 'weight';
		weight.type = 'number';
		weight.min = '0.01';
		weight.max = '1000';
		weight.step = '0.01';
		weight.inputMode = 'decimal';
		weight.placeholder = 'Till exempel 4,2';
		weight.className = 'hidden';
		weightLabel.className = 'hidden';
		recordType.addEventListener('change', () => {
			const isWeight = recordType.value === 'Vikt';
			weight.classList.toggle('hidden', !isWeight);
			weightLabel.classList.toggle('hidden', !isWeight);
			weight.required = isWeight;
		});
		recordType.dispatchEvent(new Event('change'));

		const noteLabel = element('label', 'full', 'Anteckning (valfritt)');
		noteLabel.htmlFor = `record-note-${animal.id}`;
		const note = element('textarea', 'full');
		note.id = noteLabel.htmlFor;
		note.name = 'note';
		note.maxLength = 500;
		note.placeholder = 'Till exempel hur det gick, symptom eller vad veterinären rekommenderade...';
		const save = element('button', 'primary full', 'Spara anteckning');
		save.type = 'submit';

		logForm.append(typeLabel, recordType, dateLabel, date, weightLabel, weight, noteLabel, note, save);
		return logForm;
	}

	function makeRecordItem(record, animal) {
		const row = element('div', 'log-item');
		row.append(element('span', 'log-dot'));
		const content = element('div');
		const titleText = record.type === 'Vikt' && record.weight
			? `Vikt · ${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(record.weight)} kg`
			: record.type;
		content.append(element('p', 'log-title', titleText));
		if (record.note) content.append(element('p', 'log-note', record.note));
		const date = element('span', 'log-date', formatDate(record.date));
		row.append(content, date);
		const remove = element('button', 'delete-log', 'Ta bort');
		remove.type = 'button';
		remove.dataset.deleteRecord = record.id;
		remove.dataset.animalId = animal.id;
		remove.setAttribute('aria-label', `Ta bort anteckning ${record.type} för ${animal.name}`);
		row.append(remove);
		return row;
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
			identity.append(element('span', 'animal-icon', typeIcons[animal.type] || '🐾'));
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

		const removeAnimal = element('button', 'icon-button', 'Ta bort');
		removeAnimal.type = 'button';
		removeAnimal.dataset.deleteAnimal = animal.id;
		removeAnimal.setAttribute('aria-label', `Ta bort ${animal.name}`);
		main.append(identity, removeAnimal);
		card.append(main);

		const actions = element('div', 'card-actions');
		const openProfile = document.createElement('a');
		openProfile.className = 'text-button';
		openProfile.href = `/animal.html?id=${encodeURIComponent(animal.id)}`;
		openProfile.textContent = 'Öppna profil';
		actions.append(openProfile);
		const quickClaw = element('button', 'text-button', '✂️ Klippt idag');
		quickClaw.type = 'button';
		quickClaw.dataset.quickClaw = animal.id;
		actions.append(quickClaw);
		const openHistory = element('button', 'text-button', `Skötsel & historik (${animal.records.length})`);
		openHistory.type = 'button';
		openHistory.dataset.toggleHistory = animal.id;
		actions.append(openHistory);
		card.append(actions);

		const details = element('details', 'details');
		details.dataset.history = animal.id;
		const summary = element('summary', '', 'Lägg till vikt eller skötsel');
		details.append(summary);
		const body = element('div', 'details-body');
		body.append(makeLogForm(animal));
		if (animal.records.length) {
			const history = element('div', 'log-list');
			animal.records.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(record => history.append(makeRecordItem(record, animal)));
			body.append(history);
		} else {
			body.append(element('p', 'field-hint', 'Här samlas viktmätningar, kloklippning, veterinärbesök och andra anteckningar.'));
		}
		details.append(body);
		card.append(details);
		return card;
	}

	function render() {
		renderStats();
		const query = document.querySelector('#search').value.trim().toLocaleLowerCase('sv-SE');
		const filtered = animals.filter(animal => `${animal.name} ${animal.type}`.toLocaleLowerCase('sv-SE').includes(query));
		list.replaceChildren();
		if (!filtered.length) {
			const empty = element('div', 'empty');
			empty.append(element('div', 'empty-icon', query ? '⌕' : '🐾'));
			empty.append(element('h3', '', query ? 'Inga djur hittades' : 'Här börjar er lilla flock'));
			empty.append(element('p', '', query ? 'Prova att söka med ett annat namn eller en annan djurart.' : 'Lägg till ditt första djur så kan du samla vikt, kloklippning och annan viktig information på ett ställe.'));
			list.append(empty);
			return;
		}
		filtered.forEach(animal => list.append(makeAnimalCard(animal)));
	}

	async function loadAnimals() {
		animals = await api('/api/animals');
		render();
	}

	async function init() {
		try {
			const me = await api('/api/auth/me');
			document.querySelector('#usernameLabel').textContent = me.username;
			await loadAnimals();
		} catch (error) {
			if (error.message !== 'Inte inloggad.') {
				showNotice('Kunde inte ladda dina djur. Ladda om sidan för att försöka igen.');
			}
		}
	}

	typeSelect.addEventListener('change', () => {
		customType.classList.toggle('hidden', typeSelect.value !== 'Annat');
		customType.required = typeSelect.value === 'Annat';
		updateBreedOptions(typeSelect.value === 'Annat' ? '' : typeSelect.value);
		if (typeSelect.value === 'Annat') customType.focus();
	});
	updateBreedOptions(typeSelect.value);

	form.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		const name = document.querySelector('#name').value.trim();
		const enteredWeight = document.querySelector('#initialWeight').value;
		const payload = {
			name,
			type: typeSelect.value === 'Annat' ? customType.value.trim() : typeSelect.value,
			birthday: document.querySelector('#birthday').value,
			breed: breedInput.value.trim(),
			info: document.querySelector('#info').value.trim(),
			initialWeight: enteredWeight ? Number(enteredWeight.replace(',', '.')) : null,
			sex: document.querySelector('#sex').value,
			neutered: document.querySelector('#neutered').checked
		};
		saveButton.disabled = true;
		try {
			const created = await api('/api/animals', { method: 'POST', body: JSON.stringify(payload) });
			animals = [created, ...animals];
			render();
			form.reset();
			customType.classList.add('hidden');
			customType.required = false;
			document.querySelector('#name').focus();
		} catch (error) {
			showNotice(error.message);
		} finally {
			saveButton.disabled = false;
		}
	});

	list.addEventListener('submit', async event => {
		const logForm = event.target.closest('.log-form');
		if (!logForm) return;
		event.preventDefault();
		clearNotice();
		const animal = animals.find(item => item.id === logForm.dataset.animalId);
		if (!animal) return;
		const formData = new FormData(logForm);
		const recordType = String(formData.get('recordType'));
		const payload = {
			type: recordType,
			date: String(formData.get('date')),
			weight: recordType === 'Vikt' ? Number(String(formData.get('weight')).replace(',', '.')) : null,
			note: String(formData.get('note') || '').trim()
		};
		const submitButton = logForm.querySelector('button[type="submit"]');
		submitButton.disabled = true;
		try {
			const record = await api(`/api/animals/${animal.id}/records`, { method: 'POST', body: JSON.stringify(payload) });
			animals = animals.map(item => item.id === animal.id ? { ...item, records: [record, ...item.records] } : item);
			render();
			const updatedDetails = list.querySelector(`[data-history="${CSS.escape(animal.id)}"]`);
			if (updatedDetails) updatedDetails.open = true;
		} catch (error) {
			showNotice(error.message);
		} finally {
			submitButton.disabled = false;
		}
	});

	list.addEventListener('click', async event => {
		const target = event.target.closest('button');
		if (!target) return;
		if (target.dataset.quickClaw) {
			const animal = animals.find(item => item.id === target.dataset.quickClaw);
			if (!animal) return;
			target.disabled = true;
			try {
				const record = await api(`/api/animals/${animal.id}/records`, {
					method: 'POST',
					body: JSON.stringify({ type: 'Kloklippning', date: today(), weight: null, note: '' })
				});
				const updatedAnimal = await api(`/api/animals/${animal.id}`);
				animals = animals.map(item => item.id === animal.id
					? { ...item, records: [record, ...item.records], reminders: updatedAnimal.reminders }
					: item);
				render();
				showNotice(`✂️ Kloklippning loggad för ${animal.name} idag.`, 'success');
			} catch (error) {
				showNotice(error.message);
			} finally {
				target.disabled = false;
			}
			return;
		}
		if (target.dataset.toggleHistory) {
			const details = list.querySelector(`[data-history="${CSS.escape(target.dataset.toggleHistory)}"]`);
			if (details) details.open = !details.open;
			return;
		}
		if (target.dataset.deleteAnimal) {
			const animal = animals.find(item => item.id === target.dataset.deleteAnimal);
			if (!animal || !confirm(`Ta bort ${animal.name} och all sparad historik?`)) return;
			try {
				await api(`/api/animals/${animal.id}`, { method: 'DELETE' });
				animals = animals.filter(item => item.id !== animal.id);
				render();
			} catch (error) {
				showNotice(error.message);
			}
			return;
		}
		if (target.dataset.deleteRecord) {
			const { animalId, deleteRecord } = target.dataset;
			const animal = animals.find(item => item.id === animalId);
			if (!animal || !confirm('Ta bort den här anteckningen?')) return;
			try {
				await api(`/api/animals/${animalId}/records/${deleteRecord}`, { method: 'DELETE' });
				animals = animals.map(item => item.id === animalId
					? { ...item, records: item.records.filter(record => record.id !== deleteRecord) }
					: item);
				render();
			} catch (error) {
				showNotice(error.message);
			}
		}
	});

	document.querySelector('#search').addEventListener('input', render);
	document.querySelector('#logoutButton').addEventListener('click', async () => {
		try {
			await api('/api/auth/logout', { method: 'POST' });
		} finally {
			window.location.href = '/login.html';
		}
	});

	init();
})();
