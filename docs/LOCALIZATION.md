# Interface languages and Spanish copy

Esquila supports English and Spanish for the Mac shell, local management pages,
monitors, tagger controls, and cloud administration. Existing installations and
new browsers start in Spanish; changing one interface does not switch the others.
All translations are bundled locally and never contact a translation service.

## English controls, Spanish tagging

1. On the Mac, open the sheep menu → **Configuración…**. At the top, set
   **Idioma del Mac / Mac language** to **English**. The menu changes immediately;
   close and reopen other existing windows to use the new language. It survives
   quitting/reopening Esquila. Changing language does not restart the barn server.
   macOS permission prompts use the language selected by macOS; both English and
   Spanish local-network explanations are included in the installer.
2. In the cloud admin, set **Idioma / Language** to
   **English**. The choice also covers login, account access/recovery pages,
   navigation, editors, filters, and errors. It persists in that browser.
3. Leave the phone's **Idioma / Language** set to **Español**.
   It is independent even when local controls and tagger are open in the same
   browser. The selector is available between animals and hidden during an entry
   or unconfirmed submission. Language changes ask before reloading the page.
4. For a browser-based local setup, records screen, or mobile monitor, use its
   **Idioma / Language** selector. That browser shares a local-controls preference;
   the tagger has a separate preference.

The Mac setting belongs to that Mac user. Browser preferences belong to their
origin/browser profile, not the cloud account or ranch manifest. Clearing site
storage, using another browser, or opening a different LAN address requires
choosing the browser language again. No account, secret, or ranch data is stored
in a language preference. Storage failures show an error instead of claiming the
choice was saved. Login/account email messages remain in Spanish; their linked
web screens have the language selector. The vaccination PWA remains Spanish.

## Configuration and history are data

Language settings translate built-in controls, guidance, statuses, and system
errors only. They do not translate or rewrite server names, shearer names, mode
names, colors, custom questions/answers, codes, or saved survey/mode snapshots.
Enter questions and choices in Spanish in the cloud configuration editor if that
is what tagger operators should read. An English admin can publish a Spanish
survey. Current names and historical answers never change when toggling language.

No database migration, manifest version change, sync payload change, or cloud
request is needed for language selection. Existing publication, receipt, outbox,
conflict, and tombstone behavior is unchanged. Dates still use the ranch's
`America/Santiago` time zone regardless of interface language.

## Spanish audit

The audit covered the tagger, both monitors, local onboarding/QR/records screens,
Mac settings/update dialogs and messages, every cloud admin screen (including
login, invitations and password recovery), shared validation copy, account email
copy, and vaccination PWA. Technical diagnostics and persisted ranch content are
not rewritten.

Corrections include:

- **Esqilador** → **Esquilador**; consistent **Elige**, **Ingresa**, **Cancelar**
  prompts and infinitive action labels.
- **Elija la primera letra** → **Elige el prefijo**, since prefixes can contain
  multiple letters; **No Hay** → **Sin caravana** in new defaults.
- New default wool question: **¿Cómo es la calidad de la lana?** with **Mala**,
  **Buena**, **Excelente**. The adjective agrees with *calidad*.
- New default lactation question: **¿La oveja está en lactancia?** with **Sí**,
  **No**, **No sé**, replacing ambiguous **Lactante / OK / Seca**. Stored response
  IDs remain `OK`, `dry`, and `idk` for compatibility.
- **Desactualizados** for stale data; clearer email-delivery and recovery guidance;
  network setup no longer implies that internet is needed for counting.
- **Caravana**, **tratamiento predefinido**, sentence-case actions, and **2 ml**
  replace English/mixed-style vaccination UI wording. Empty results and pending
  data wording are explicit.

These default-question corrections apply to newly created configurations.
Existing published configurations retain their labels. To improve an existing
survey, edit its display names/questions in cloud configuration and publish;
keep the question/option IDs. Only new animals receive that wording. Legacy
migration labels and saved historical snapshots deliberately remain unchanged.

## Maintenance and verification

`shared/i18n.js` provides pure English/Spanish translation and bounded system-error
translation. `shared/locales/` contains reviewed catalogs. `browser-language.js`
selects a per-surface preference; `page-language.js` translates static HTML once,
before any ranch content is inserted. Dynamic UI explicitly calls `t(...)` or a
`t` template. Never pass ranch-authored labels to `t`, and never run a translation
observer over a live document. Render interpolation values as text, not HTML.

Add both translations for new interface messages and preserve interpolation slots.
The unit suite checks slot parity, invalid-language fallback, literal interpolation,
IPC errors, and unchanged survey history. Browser coverage checks English cloud
navigation/login/editing, Spanish question preservation, English local controls
alongside a Spanish tagger, offline QR/counting, ambiguous-response replay,
restart persistence, native settings integration, update errors, and phone layout.
Run the full merge gate and the Apple Silicon installer check before release.
