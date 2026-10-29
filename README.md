# Emploitic Date Sorter (Unofficial)

A small extension and Tampermonkey userscript that adds a **sort by publication
date** option to Emploitic's job list:

https://emploitic.com/offres-d-emploi

## Why I built this

The site has no date sort, and featured offers are mixed with normal results.
I wanted to see the newest or oldest offers, including across all pages, without
downloading the entire job list at once.

## How it works

- **Cette page** reorders the 20 cards currently displayed.
- **Toutes les pages** shows a paginated global view, 20 offers per page.
- The native **Toutes / Pour toi** tabs stay visible in the global view.
  Clicking **Pour toi** pauses the global view; **Toutes** resumes it.

The global view uses the same internal HTTP endpoints as Emploitic's own
frontend, not an official public API:

```http
GET /api/v4/jobboard/jobs/search?sortedBy=publishedAt&sortOrder=desc&page=1&limit=20
```

For the global view, the extension loads all matching results in batches of
1,000 (up to 10,000), deduplicates them, sorts the complete set by publication
date, and paginates locally. Search requests use v1.3.1's
`rankingScoreThreshold=0` so all matching offers are included.

It also reads `/_next/data/...` for exact dates and `/_next/image?...` for logos.
These endpoints can change, be rate-limited, or stop working at any time.

## Install

**Chrome / Edge / Brave / Opera (Chromium)**

1. Open `chrome://extensions`, `edge://extensions`, `brave://extensions`, or
   `opera://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension` folder.
4. Reload https://emploitic.com/offres-d-emploi.

**Firefox 140+**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `extension-firefox/manifest.json`.
4. Reload https://emploitic.com/offres-d-emploi.

For a permanent Firefox install, the add-on must be signed through
[addons.mozilla.org](https://addons.mozilla.org/).

**Tampermonkey / Violentmonkey**

1. Create a new userscript.
2. Paste the contents of `emploitic-date-sort.user.js`.
3. Save and reload the job list.

## Notes

- This is an unofficial project, not affiliated with Emploitic.
- The global view loads all matching offers once, then paginates the sorted
  result locally. Large searches are capped at 10,000 offers.
- Only the selected sort mode is stored; no personal data is collected.
- Search results follow the site's own results, including French-accented queries.

## License

Licensed under the **GNU General Public License v3.0**. See [LICENSE](./LICENSE).
