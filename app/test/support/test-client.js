'use strict';

// Enkel cookie-jar-klient ovanpå global fetch, så tester kan simulera en
// inloggad webbläsarsession (sparar och skickar med Set-Cookie mellan
// anrop) utan ett tungt beroende.

class TestClient {
	constructor(baseUrl) {
		this.baseUrl = baseUrl;
		this.cookies = new Map();
	}

	_cookieHeader() {
		return [...this.cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
	}

	_storeCookies(response) {
		const raw = typeof response.headers.getSetCookie === 'function'
			? response.headers.getSetCookie()
			: (response.headers.get('set-cookie') ? [response.headers.get('set-cookie')] : []);
		raw.forEach(cookieStr => {
			const [pair] = cookieStr.split(';');
			const eqIndex = pair.indexOf('=');
			if (eqIndex === -1) return;
			const name = pair.slice(0, eqIndex).trim();
			const value = pair.slice(eqIndex + 1).trim();
			this.cookies.set(name, value);
		});
	}

	async request(method, pathName, { body, headers = {}, rawBody } = {}) {
		const isForm = rawBody !== undefined;
		const response = await fetch(`${this.baseUrl}${pathName}`, {
			method,
			headers: {
				...(isForm ? {} : (body !== undefined ? { 'Content-Type': 'application/json' } : {})),
				...(this._cookieHeader() ? { Cookie: this._cookieHeader() } : {}),
				...headers
			},
			body: isForm ? rawBody : (body !== undefined ? JSON.stringify(body) : undefined)
		});
		this._storeCookies(response);
		let data = null;
		const text = await response.text();
		if (text) {
			try { data = JSON.parse(text); } catch { data = text; }
		}
		return { status: response.status, data, headers: response.headers };
	}

	get(pathName, options) { return this.request('GET', pathName, options); }
	post(pathName, body, options) { return this.request('POST', pathName, { ...options, body }); }
	put(pathName, body, options) { return this.request('PUT', pathName, { ...options, body }); }
	delete(pathName, options) { return this.request('DELETE', pathName, options); }
}

module.exports = { TestClient };
