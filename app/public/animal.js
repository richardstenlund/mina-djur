(() => {
	const LOG_TYPES = ['Vikt', 'Kloklippning', 'Veterinärbesök', 'Medicin', 'Vaccination', 'Pälsvård', 'Övrigt'];
	const typeIcons = { Katt: '🐈', Kanin: '🐇', Marsvin: '🐹', Hamster: '🐹', Råtta: '🐭', Mus: '🐭', Fågel: '🐦' };
	const notice = document.querySelector('#notice');
	const gallery = document.querySelector('#gallery');
	const photoForm = document.querySelector('#photoForm');
	const photoInput = document.querySelector('#photoInput');
	const profileForm = document.querySelector('#profileForm');
	const logForm = document.querySelector('#logForm');
	const logList = document.querySelector('#logList');

	const params = new URLSearchParams(window.location.search);
	const animalId = params.get('id');
	let animal = null;

	function showNotice(message) {
		notice.textContent = message;
		notice.classList.add('visible');
	}

	if (!animalId) {
		showNotice('Inget djur valt. Gå till startsidan och klicka på "Öppna profil" på ett djur.');
		document.querySelector('.profile-panel').classList.add('hidden');
		document.querySelector('.content-panel').classList.add('hidden');
	}

	function clearNotice() {
		notice.classList.remove('visible');
	}

	async function api(path, options = {}) {
		const response = await fetch(path, {
			...options,
			headers: options.body instanceof FormData
				? (options.headers || {})
				: { 'Content-Type': 'application/json', ...(options.headers || {}) }
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

	function renderProfile() {
		document.title = `${animal.name} – Mina djur`;
		document.querySelector('#profile-title').textContent = animal.name;
		document.querySelector('#profileType').textContent = animal.type;
		const icon = document.querySelector('#profileIcon');
		if (animal.photos.length) {
			icon.replaceWith(Object.assign(document.createElement('img'), {
				id: 'profileIcon', className: 'animal-cover profile-icon', src: animal.photos[0].url, alt: `Foto på ${animal.name}`
			}));
		} else {
			icon.textContent = typeIcons[animal.type] || '🐾';
		}

		document.querySelector('#name').value = animal.name;
		document.querySelector('#type').value = animal.type;
		document.querySelector('#birthday').value = animal.birthday || '';
		document.querySelector('#initialWeight').value = animal.initialWeight ?? '';
		document.querySelector('#info').value = animal.info || '';

		gallery.innerHTML = '';
		if (!animal.photos.length) {
			gallery.append(element('p', 'field-hint', 'Inga bilder ännu. Ladda upp den första nedan.'));
		}
		animal.photos.forEach(photo => {
			const figure = element('figure', 'gallery-item');
			const img = document.createElement('img');
			img.src = photo.url;
			img.alt = `Foto på ${animal.name}`;
			const remove = element('button', 'delete-log', 'Ta bort');
			remove.type = 'button';
			remove.dataset.deletePhoto = photo.id;
			figure.append(img, remove);
			gallery.append(figure);
		});
	}

	function makeRecordItem(record) {
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
		row.append(remove);
		return row;
	}

	function renderRecords() {
		logList.innerHTML = '';
		if (!animal.records.length) {
			logList.append(element('p', 'field-hint', 'Här samlas viktmätningar, kloklippning, veterinärbesök och andra anteckningar.'));
			return;
		}
		animal.records.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(record => logList.append(makeRecordItem(record)));
	}

	function buildLogForm() {
		logForm.innerHTML = '';
		const typeLabel = element('label', '', 'Vad vill du anteckna?');
		typeLabel.htmlFor = 'record-type';
		const recordType = element('select');
		recordType.id = 'record-type';
		recordType.name = 'recordType';
		LOG_TYPES.forEach(type => recordType.add(new Option(type, type)));

		const dateLabel = element('label', '', 'Datum');
		dateLabel.htmlFor = 'record-date';
		const date = element('input');
		date.id = 'record-date';
		date.name = 'date';
		date.type = 'date';
		date.value = today();
		date.required = true;

		const weightLabel = element('label', '', 'Vikt i kg');
		weightLabel.htmlFor = 'record-weight';
		const weight = element('input');
		weight.id = 'record-weight';
		weight.name = 'weight';
		weight.type = 'number';
		weight.min = '0.01';
		weight.max = '1000';
		weight.step = '0.01';
		weight.inputMode = 'decimal';
		weight.placeholder = 'Till exempel 4,2';
		recordType.addEventListener('change', () => {
			const isWeight = recordType.value === 'Vikt';
			weight.classList.toggle('hidden', !isWeight);
			weightLabel.classList.toggle('hidden', !isWeight);
			weight.required = isWeight;
		});

		const noteLabel = element('label', 'full', 'Anteckning (valfritt)');
		noteLabel.htmlFor = 'record-note';
		const note = element('textarea', 'full');
		note.id = 'record-note';
		note.name = 'note';
		note.maxLength = 500;
		const save = element('button', 'primary full', 'Spara anteckning');
		save.type = 'submit';

		logForm.append(typeLabel, recordType, dateLabel, date, weightLabel, weight, noteLabel, note, save);
		recordType.dispatchEvent(new Event('change'));
	}

	async function load() {
		try {
			animal = await api(`/api/animals/${encodeURIComponent(animalId)}`);
			renderProfile();
			renderRecords();
		} catch (error) {
			showNotice(error.message);
		}
	}

	photoForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		if (!photoInput.files.length) return;
		const formData = new FormData();
		formData.append('photo', photoInput.files[0]);
		const submitButton = photoForm.querySelector('button[type="submit"]');
		submitButton.disabled = true;
		try {
			const photo = await api(`/api/animals/${animalId}/photos`, { method: 'POST', body: formData });
			animal.photos.push(photo);
			renderProfile();
			photoForm.reset();
		} catch (error) {
			showNotice(error.message);
		} finally {
			submitButton.disabled = false;
		}
	});

	gallery.addEventListener('click', async event => {
		const button = event.target.closest('button[data-delete-photo]');
		if (!button) return;
		if (!confirm('Ta bort den här bilden?')) return;
		try {
			await api(`/api/animals/${animalId}/photos/${button.dataset.deletePhoto}`, { method: 'DELETE' });
			animal.photos = animal.photos.filter(photo => photo.id !== button.dataset.deletePhoto);
			renderProfile();
		} catch (error) {
			showNotice(error.message);
		}
	});

	profileForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		const payload = {
			name: document.querySelector('#name').value.trim(),
			type: document.querySelector('#type').value.trim(),
			birthday: document.querySelector('#birthday').value,
			info: document.querySelector('#info').value.trim(),
			initialWeight: document.querySelector('#initialWeight').value
				? Number(document.querySelector('#initialWeight').value.replace(',', '.'))
				: null
		};
		const submitButton = profileForm.querySelector('button[type="submit"]');
		submitButton.disabled = true;
		try {
			const updated = await api(`/api/animals/${animalId}`, { method: 'PUT', body: JSON.stringify(payload) });
			animal = { ...animal, ...updated };
			renderProfile();
			showNotice('Sparat!');
		} catch (error) {
			showNotice(error.message);
		} finally {
			submitButton.disabled = false;
		}
	});

	logForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
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
			const record = await api(`/api/animals/${animalId}/records`, { method: 'POST', body: JSON.stringify(payload) });
			animal.records = [record, ...animal.records];
			renderRecords();
			logForm.reset();
			buildLogForm();
		} catch (error) {
			showNotice(error.message);
		} finally {
			submitButton.disabled = false;
		}
	});

	logList.addEventListener('click', async event => {
		const button = event.target.closest('button[data-delete-record]');
		if (!button) return;
		if (!confirm('Ta bort den här anteckningen?')) return;
		try {
			await api(`/api/animals/${animalId}/records/${button.dataset.deleteRecord}`, { method: 'DELETE' });
			animal.records = animal.records.filter(record => record.id !== button.dataset.deleteRecord);
			renderRecords();
		} catch (error) {
			showNotice(error.message);
		}
	});

	document.querySelector('#logoutButton').addEventListener('click', async () => {
		try {
			await api('/api/auth/logout', { method: 'POST' });
		} finally {
			window.location.href = '/login.html';
		}
	});

	buildLogForm();
	if (animalId) load();
})();
