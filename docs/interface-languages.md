# Interface languages

English is the default. English / Русский buttons are visible in the top bar on desktop and mobile, including account pages. The selected language is stored under dosvyazi.language in localStorage and follows subsequent page loads; other tabs observe changes. If storage is unavailable the selection applies to the current page only. Account credentials/cookies are never stored there.

A React context updates translated labels, accessible names and date formatting without remounting routes/forms or the voice client. User names, community/channel/role names and message content retain their original text. Permission select values and API identifiers remain language-independent. The bundled catalog needs no network translation service or added dependency. Common server and client errors have Russian translations; unknown future server text falls back to English.

Read-only queries retry at most twice on transport failure or 502/503/504, with bounded delay. Authentication/access errors and mutations do not use that retry policy. Deliberate AbortSignal cancellation retains its abort reason rather than reporting a failed connection. Persistent failures still show an error and retry action. See [TanStack query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation).
