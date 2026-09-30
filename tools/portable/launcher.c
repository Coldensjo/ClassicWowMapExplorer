// Map Explorer's portable launcher: serves the built app (the "app" folder next to this exe)
// on 127.0.0.1 and shows it in a window of its own (Edge's or Chrome's app mode), with no
// console. The app needs a web server: module workers and fetch don't work from file:// pages.
// Closing the window stops it.
//
// Built by tools/buildPortable.ts (gcc from mingw-w64).

#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <shellapi.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

// The same port every time, so the browser keeps the page's settings (they're per origin);
// the next ones along if something else has it.
#define FIRST_PORT 51730
#define PORT_TRIES 20
// Answered by a running launcher, so a second one just opens the page instead of another server.
#define HELLO_PATH "/__mapexplorer"
#define HELLO_BODY "Map Explorer"

static wchar_t appDir[MAX_PATH];

struct MimeType {
	const char *extension;
	const char *type;
};

static const struct MimeType MIME_TYPES[] = {
	{".html", "text/html; charset=utf-8"},
	{".js", "text/javascript; charset=utf-8"},
	{".mjs", "text/javascript; charset=utf-8"},
	{".css", "text/css; charset=utf-8"},
	{".json", "application/json"},
	{".svg", "image/svg+xml"},
	{".png", "image/png"},
	{".ico", "image/x-icon"},
	{".wasm", "application/wasm"},
	{".woff2", "font/woff2"},
	{".txt", "text/plain; charset=utf-8"},
};

static const char *mimeType(const char *path) {
	const char *dot = strrchr(path, '.');
	if (dot) {
		for (size_t i = 0; i < sizeof MIME_TYPES / sizeof MIME_TYPES[0]; i++) {
			if (_stricmp(dot, MIME_TYPES[i].extension) == 0) return MIME_TYPES[i].type;
		}
	}
	return "application/octet-stream";
}

static void sendAll(SOCKET s, const char *data, int length) {
	while (length > 0) {
		int sent = send(s, data, length, 0);
		if (sent <= 0) return;
		data += sent;
		length -= sent;
	}
}

static void sendStatus(SOCKET s, const char *status, const char *body) {
	char header[256];
	int n = snprintf(header, sizeof header,
		"HTTP/1.1 %s\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: %d\r\nConnection: close\r\n\r\n",
		status, (int)strlen(body));
	sendAll(s, header, n);
	sendAll(s, body, (int)strlen(body));
}

static int hexValue(char c) {
	if (c >= '0' && c <= '9') return c - '0';
	if (c >= 'a' && c <= 'f') return c - 'a' + 10;
	if (c >= 'A' && c <= 'F') return c - 'A' + 10;
	return -1;
}

// Decodes %XX in place and drops the query or fragment. False for a path that could leave
// the app folder or name something odd.
static int cleanPath(char *path) {
	char *end = strpbrk(path, "?#");
	if (end) *end = 0;
	char *out = path;
	for (char *in = path; *in; in++) {
		if (in[0] == '%' && hexValue(in[1]) >= 0 && hexValue(in[2]) >= 0) {
			*out++ = (char)(hexValue(in[1]) * 16 + hexValue(in[2]));
			in += 2;
		} else {
			*out++ = *in;
		}
	}
	*out = 0;
	if (path[0] != '/' || strchr(path, '\\') || strchr(path, ':') || strstr(path, "..")) return 0;
	for (char *c = path; *c; c++) {
		if ((unsigned char)*c < 32) return 0;
	}
	return 1;
}

static DWORD WINAPI serve(LPVOID param) {
	SOCKET s = (SOCKET)(ULONG_PTR)param;
	char request[8192];
	int length = 0;
	// Read the request line and headers (there's no body for GET or HEAD).
	while (length < (int)sizeof request - 1) {
		int n = recv(s, request + length, (int)sizeof request - 1 - length, 0);
		if (n <= 0) break;
		length += n;
		request[length] = 0;
		if (strstr(request, "\r\n\r\n")) break;
	}
	request[length] = 0;

	char method[8] = {0};
	char path[2048] = {0};
	if (sscanf(request, "%7s %2047s", method, path) != 2) {
		sendStatus(s, "400 Bad Request", "Bad request");
	} else if (strcmp(method, "GET") != 0 && strcmp(method, "HEAD") != 0) {
		sendStatus(s, "405 Method Not Allowed", "Only GET and HEAD");
	} else if (!cleanPath(path)) {
		sendStatus(s, "404 Not Found", "Not found");
	} else if (strcmp(path, HELLO_PATH) == 0) {
		sendStatus(s, "200 OK", HELLO_BODY);
	} else {
		if (path[strlen(path) - 1] == '/') strncat(path, "index.html", sizeof path - strlen(path) - 1);
		// The URL path (UTF-8) -> a file under the app folder.
		wchar_t relative[2048];
		wchar_t file[MAX_PATH * 2];
		MultiByteToWideChar(CP_UTF8, 0, path, -1, relative, 2048);
		for (wchar_t *c = relative; *c; c++) {
			if (*c == L'/') *c = L'\\';
		}
		swprintf(file, sizeof file / sizeof file[0], L"%ls%ls", appDir, relative);
		HANDLE f = CreateFileW(file, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
		LARGE_INTEGER size;
		if (f == INVALID_HANDLE_VALUE || !GetFileSizeEx(f, &size)) {
			if (f != INVALID_HANDLE_VALUE) CloseHandle(f);
			sendStatus(s, "404 Not Found", "Not found");
		} else {
			char header[512];
			int n = snprintf(header, sizeof header,
				"HTTP/1.1 200 OK\r\nContent-Type: %s\r\nContent-Length: %lld\r\nCache-Control: no-cache\r\nConnection: close\r\n\r\n",
				mimeType(path), (long long)size.QuadPart);
			sendAll(s, header, n);
			if (strcmp(method, "GET") == 0) {
				char chunk[65536];
				DWORD read;
				while (ReadFile(f, chunk, sizeof chunk, &read, NULL) && read > 0) sendAll(s, chunk, (int)read);
			}
			CloseHandle(f);
		}
	}
	shutdown(s, SD_SEND);
	closesocket(s);
	return 0;
}

// Whether a Map Explorer launcher already answers on this port.
static int alreadyRunning(int port) {
	SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
	if (s == INVALID_SOCKET) return 0;
	struct sockaddr_in address = {0};
	address.sin_family = AF_INET;
	address.sin_port = htons((u_short)port);
	address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
	int found = 0;
	if (connect(s, (struct sockaddr *)&address, sizeof address) == 0) {
		const char *hello = "GET " HELLO_PATH " HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
		sendAll(s, hello, (int)strlen(hello));
		char reply[1024] = {0};
		int length = 0, n;
		while (length < (int)sizeof reply - 1 && (n = recv(s, reply + length, (int)sizeof reply - 1 - length, 0)) > 0) length += n;
		found = strstr(reply, HELLO_BODY) != NULL;
	}
	closesocket(s);
	return found;
}

static void fail(const wchar_t *message) {
	MessageBoxW(NULL, message, L"Map Explorer", MB_OK | MB_ICONERROR);
}

// A browser that can show a page as an app window (--app): Edge, which every Windows 10 and 11
// has, else Chrome. Found through App Paths, as Windows' Run box does, then the usual places.
static int findBrowser(wchar_t *out, DWORD size) {
	static const wchar_t *const NAMES[] = {L"msedge.exe", L"chrome.exe"};
	static const wchar_t *const FOLDERS[] = {L"Microsoft\\Edge\\Application\\msedge.exe", L"Google\\Chrome\\Application\\chrome.exe"};
	static const wchar_t *const ROOTS[] = {L"ProgramFiles(x86)", L"ProgramFiles", L"LOCALAPPDATA"};
	for (int i = 0; i < 2; i++) {
		wchar_t key[128];
		swprintf(key, 128, L"SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\%ls", NAMES[i]);
		HKEY hives[] = {HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
		for (int h = 0; h < 2; h++) {
			DWORD bytes = size * sizeof(wchar_t);
			if (RegGetValueW(hives[h], key, NULL, RRF_RT_REG_SZ, NULL, out, &bytes) == ERROR_SUCCESS && GetFileAttributesW(out) != INVALID_FILE_ATTRIBUTES) return 1;
		}
		for (int r = 0; r < 3; r++) {
			wchar_t root[MAX_PATH];
			if (!GetEnvironmentVariableW(ROOTS[r], root, MAX_PATH)) continue;
			swprintf(out, size, L"%ls\\%ls", root, FOLDERS[i]);
			if (GetFileAttributesW(out) != INVALID_FILE_ATTRIBUTES) return 1;
		}
	}
	return 0;
}

// Whether a folder can be written to (a probe file that deletes itself).
static int writable(const wchar_t *dir) {
	wchar_t probe[MAX_PATH * 2];
	swprintf(probe, MAX_PATH * 2, L"%ls\\.writable", dir);
	HANDLE f = CreateFileW(probe, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_TEMPORARY | FILE_FLAG_DELETE_ON_CLOSE, NULL);
	if (f == INVALID_HANDLE_VALUE) return 0;
	CloseHandle(f);
	return 1;
}

// Where the app window keeps its browser data (settings, the chosen folder's permission):
// data\browser next to the exe, so it travels with the portable folder and stays apart from
// your own browser profile; in %LOCALAPPDATA% if the exe's folder is read-only.
static void profileDir(const wchar_t *exeDir, wchar_t *out, size_t size) {
	swprintf(out, size, L"%lsdata", exeDir);
	CreateDirectoryW(out, NULL);
	wcsncat(out, L"\\browser", size - wcslen(out) - 1);
	CreateDirectoryW(out, NULL);
	if (writable(out)) return;
	wchar_t local[MAX_PATH];
	GetEnvironmentVariableW(L"LOCALAPPDATA", local, MAX_PATH);
	swprintf(out, size, L"%ls\\MapExplorer", local);
	CreateDirectoryW(out, NULL);
	wcsncat(out, L"\\browser", size - wcslen(out) - 1);
	CreateDirectoryW(out, NULL);
}

// Whether a browser still has the profile open: it holds its "lockfile" while it runs.
static int profileInUse(const wchar_t *profile) {
	wchar_t lock[MAX_PATH * 2];
	swprintf(lock, MAX_PATH * 2, L"%ls\\lockfile", profile);
	if (GetFileAttributesW(lock) == INVALID_FILE_ATTRIBUTES) return 0;
	HANDLE f = CreateFileW(lock, GENERIC_READ, 0, NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
	if (f == INVALID_HANDLE_VALUE) return GetLastError() == ERROR_SHARING_VIOLATION;
	CloseHandle(f);
	return 0;
}

// Opens the page in its own app window (no tabs or address bar) and returns the browser
// process; NULL if there's no such browser, when the page opens in the default browser instead.
static HANDLE openWindow(int port, const wchar_t *profile) {
	wchar_t url[64];
	swprintf(url, 64, L"http://127.0.0.1:%d/", port);
	wchar_t browser[MAX_PATH];
	if (!findBrowser(browser, MAX_PATH)) {
		ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
		return NULL;
	}
	wchar_t command[MAX_PATH * 4];
	swprintf(command, sizeof command / sizeof command[0],
		L"\"%ls\" --app=%ls --user-data-dir=\"%ls\" --start-maximized --no-first-run --no-default-browser-check",
		browser, url, profile);
	STARTUPINFOW startup = {sizeof startup};
	PROCESS_INFORMATION process;
	if (!CreateProcessW(browser, command, NULL, NULL, FALSE, 0, NULL, NULL, &startup, &process)) {
		ShellExecuteW(NULL, L"open", url, NULL, NULL, SW_SHOWNORMAL);
		return NULL;
	}
	CloseHandle(process.hThread);
	return process.hProcess;
}

static DWORD WINAPI acceptLoop(LPVOID param) {
	SOCKET listener = (SOCKET)(ULONG_PTR)param;
	for (;;) {
		SOCKET client = accept(listener, NULL, NULL);
		if (client == INVALID_SOCKET) continue;
		HANDLE thread = CreateThread(NULL, 0, serve, (LPVOID)(ULONG_PTR)client, 0, NULL);
		if (thread) CloseHandle(thread);
		else closesocket(client);
	}
	return 0;
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE previous, PWSTR arguments, int show) {
	(void)instance;
	(void)previous;
	(void)show;
	// --no-browser: serve only, for testing (stop it from Task Manager).
	int noBrowser = wcsstr(arguments, L"--no-browser") != NULL;

	// The app folder sits next to the exe.
	wchar_t exeDir[MAX_PATH];
	GetModuleFileNameW(NULL, exeDir, MAX_PATH);
	wchar_t *slash = wcsrchr(exeDir, L'\\');
	if (slash) slash[1] = 0;
	swprintf(appDir, MAX_PATH, L"%lsapp", exeDir);
	wchar_t index[MAX_PATH * 2];
	swprintf(index, sizeof index / sizeof index[0], L"%ls\\index.html", appDir);
	if (GetFileAttributesW(index) == INVALID_FILE_ATTRIBUTES) {
		fail(L"The \"app\" folder is missing: keep MapExplorer.exe together with it.");
		return 1;
	}
	wchar_t profile[MAX_PATH * 2];
	profileDir(exeDir, profile, sizeof profile / sizeof profile[0]);

	WSADATA wsa;
	if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return 1;

	SOCKET listener = INVALID_SOCKET;
	int port = 0;
	for (int p = FIRST_PORT; p < FIRST_PORT + PORT_TRIES; p++) {
		if (alreadyRunning(p)) {
			// Already running: just another window onto it.
			if (!noBrowser) {
				HANDLE window = openWindow(p, profile);
				if (window) CloseHandle(window);
			}
			WSACleanup();
			return 0;
		}
		SOCKET s = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
		// Only this computer can reach it.
		struct sockaddr_in address = {0};
		address.sin_family = AF_INET;
		address.sin_port = htons((u_short)p);
		address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
		BOOL exclusive = TRUE;
		setsockopt(s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, (const char *)&exclusive, sizeof exclusive);
		if (bind(s, (struct sockaddr *)&address, sizeof address) == 0 && listen(s, SOMAXCONN) == 0) {
			listener = s;
			port = p;
			break;
		}
		closesocket(s);
	}
	if (listener == INVALID_SOCKET) {
		wchar_t message[128];
		swprintf(message, 128, L"No free port between %d and %d.", FIRST_PORT, FIRST_PORT + PORT_TRIES - 1);
		fail(message);
		return 1;
	}
	HANDLE server = CreateThread(NULL, 0, acceptLoop, (LPVOID)(ULONG_PTR)listener, 0, NULL);
	if (noBrowser) {
		WaitForSingleObject(server, INFINITE);
		return 0;
	}

	HANDLE window = openWindow(port, profile);
	if (!window) {
		// No app window to watch: the page is in the default browser instead.
		MessageBoxW(NULL, L"Map Explorer is open in your browser.\n\nPress OK when you're done, to stop it.", L"Map Explorer", MB_OK | MB_ICONINFORMATION);
		return 0;
	}
	// Serve until the window closes: its browser process ends, and no other window (a second
	// launch, or one the browser handed over to) still has the profile open.
	WaitForSingleObject(window, INFINITE);
	CloseHandle(window);
	do Sleep(1000);
	while (profileInUse(profile));
	return 0;
}
